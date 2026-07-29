#![deny(unsafe_op_in_unsafe_fn)]

use std::collections::HashMap;

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptionStatus {
    Provisional,
    Final,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caption {
    pub id: String,
    pub revision: u32,
    pub status: CaptionStatus,
    pub source_text: String,
    pub english_text: String,
}

#[derive(Debug, Default)]
pub struct CaptionStore {
    captions: HashMap<String, Caption>,
}

impl CaptionStore {
    pub fn upsert(&mut self, caption: Caption) -> Result<(), CaptionStoreError> {
        if let Some(existing) = self.captions.get(&caption.id) {
            if existing.status == CaptionStatus::Final {
                return Err(CaptionStoreError::FinalIsTerminal);
            }
            if caption.revision <= existing.revision {
                return Err(CaptionStoreError::StaleRevision);
            }
        }

        self.captions.insert(caption.id.clone(), caption);
        Ok(())
    }

    #[must_use]
    pub fn get(&self, id: &str) -> Option<&Caption> {
        self.captions.get(id)
    }

    pub fn clear(&mut self) {
        self.captions.clear();
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CaptionStoreError {
    #[error("caption revision is stale")]
    StaleRevision,
    #[error("final captions are terminal")]
    FinalIsTerminal,
}

#[cfg(test)]
mod tests {
    use super::{Caption, CaptionStatus, CaptionStore, CaptionStoreError};

    fn caption(revision: u32, status: CaptionStatus) -> Caption {
        Caption {
            id: "caption-1".to_owned(),
            revision,
            status,
            source_text: "adto ta b".to_owned(),
            english_text: "let's go B".to_owned(),
        }
    }

    #[test]
    fn rejects_stale_revisions() {
        let mut store = CaptionStore::default();
        store
            .upsert(caption(2, CaptionStatus::Provisional))
            .expect("initial caption should be accepted");

        assert_eq!(
            store.upsert(caption(1, CaptionStatus::Provisional)),
            Err(CaptionStoreError::StaleRevision)
        );
    }

    #[test]
    fn final_caption_is_terminal() {
        let mut store = CaptionStore::default();
        store
            .upsert(caption(2, CaptionStatus::Final))
            .expect("final caption should be accepted");

        assert_eq!(
            store.upsert(caption(3, CaptionStatus::Provisional)),
            Err(CaptionStoreError::FinalIsTerminal)
        );
    }
}
