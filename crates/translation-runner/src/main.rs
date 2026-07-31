#![deny(unsafe_op_in_unsafe_fn)]

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail};
use candle_core::{Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_t5 as t5;
use serde::{Deserialize, Serialize};
use tokenizers::Tokenizer;

const MAX_INPUT_BYTES: usize = 4 * 1024;
const MAX_INPUT_TOKENS: usize = 512;
const MAX_OUTPUT_TOKENS: usize = 256;

#[derive(Debug, Deserialize)]
struct Request {
    id: String,
    text: String,
}

#[derive(Debug, Serialize)]
struct Response {
    id: String,
    english_text: String,
    inference_ms: f64,
}

struct Translator {
    device: Device,
    config: t5::Config,
    model: t5::T5ForConditionalGeneration,
    tokenizer: Tokenizer,
}

impl Translator {
    fn load(model_dir: &Path) -> Result<Self> {
        let device = Device::Cpu;
        let config: t5::Config = serde_json::from_slice(
            &std::fs::read(model_dir.join("config.json"))
                .context("translation config is unavailable")?,
        )
        .context("translation config is invalid")?;
        let tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(anyhow::Error::msg)
            .context("translation tokenizer is invalid")?;
        let variable_builder = t5::VarBuilder::from_gguf(model_dir.join("model-q4k.gguf"), &device)
            .context("translation weights are invalid")?;
        let model = t5::T5ForConditionalGeneration::load(variable_builder, &config)
            .context("translation model could not load")?;
        Ok(Self {
            device,
            config,
            model,
            tokenizer,
        })
    }

    fn translate(&mut self, source: &str) -> Result<String> {
        // Candle's T5 decoder keeps key/value state for incremental generation.
        // Each IPC request is an independent sentence, so retaining that state
        // corrupts every translation after the first one.
        self.model.clear_kv_cache();
        let prompt = format!("<2en> {source}");
        let encoding = self
            .tokenizer
            .encode(prompt, true)
            .map_err(anyhow::Error::msg)?;
        if encoding.len() > MAX_INPUT_TOKENS {
            bail!("translation input exceeds the token limit");
        }
        let input_ids = Tensor::new(encoding.get_ids(), &self.device)?.unsqueeze(0)?;
        let encoder_output = self.model.encode(&input_ids)?;
        let start_token = self
            .config
            .decoder_start_token_id
            .unwrap_or(self.config.pad_token_id) as u32;
        let mut output_ids = vec![start_token];
        let mut logits_processor = LogitsProcessor::new(299_792_458, None, None);
        for index in 0..MAX_OUTPUT_TOKENS {
            let decoder_ids = if index == 0 || !self.config.use_cache {
                Tensor::new(output_ids.as_slice(), &self.device)?.unsqueeze(0)?
            } else {
                let last = *output_ids.last().context("decoder output was empty")?;
                Tensor::new(&[last], &self.device)?.unsqueeze(0)?
            };
            let logits = self
                .model
                .decode(&decoder_ids, &encoder_output)?
                .squeeze(0)?;
            let start_at = output_ids.len().saturating_sub(64);
            let logits = candle_transformers::utils::apply_repeat_penalty(
                &logits,
                1.1,
                &output_ids[start_at..],
            )?;
            let next_token = logits_processor.sample(&logits)?;
            if next_token as usize == self.config.eos_token_id {
                break;
            }
            output_ids.push(next_token);
        }
        self.tokenizer
            .decode(&output_ids[1..], true)
            .map_err(anyhow::Error::msg)
    }
}

fn model_dir_from_args() -> Result<PathBuf> {
    let mut arguments = std::env::args_os();
    let _program = arguments.next();
    let model_dir = arguments
        .next()
        .map(PathBuf::from)
        .context("usage: translation-runner <verified-model-directory>")?;
    if arguments.next().is_some() || !model_dir.is_dir() {
        bail!("translation model directory is invalid");
    }
    Ok(model_dir)
}

fn main() -> Result<()> {
    let model_dir = model_dir_from_args()?;
    let mut translator = Translator::load(&model_dir)?;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.context("translation request could not be read")?;
        if line.len() > MAX_INPUT_BYTES {
            bail!("translation request exceeds the size limit");
        }
        let request: Request =
            serde_json::from_str(&line).context("translation request is invalid")?;
        let started = Instant::now();
        let english_text = translator.translate(&request.text)?;
        let response = Response {
            id: request.id,
            english_text,
            inference_ms: started.elapsed().as_secs_f64() * 1_000.0,
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
