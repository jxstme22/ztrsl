import {
  EMPTY_GLOSSARY_SET,
  EMPTY_PHRASE_FILTER_SET,
  glossarySetSchema,
  phraseFilterSetSchema,
  type GlossarySet,
  type PhraseFilterSet,
} from "./model";

const PHRASE_FILTERS_KEY = "local-squad-translator.caption-trust.filters.v1";
const GLOSSARY_KEY = "local-squad-translator.caption-trust.glossary.v1";

export function loadPhraseFilters(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): PhraseFilterSet {
  const serialized = storage.getItem(PHRASE_FILTERS_KEY);
  if (serialized === null) {
    return EMPTY_PHRASE_FILTER_SET;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = phraseFilterSetSchema.safeParse(parsed);
    return result.success ? result.data : EMPTY_PHRASE_FILTER_SET;
  } catch {
    return EMPTY_PHRASE_FILTER_SET;
  }
}

export function savePhraseFilters(
  filters: PhraseFilterSet,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(PHRASE_FILTERS_KEY, JSON.stringify(filters));
}

export function loadGlossary(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): GlossarySet {
  const serialized = storage.getItem(GLOSSARY_KEY);
  if (serialized === null) {
    return EMPTY_GLOSSARY_SET;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    const result = glossarySetSchema.safeParse(parsed);
    return result.success ? result.data : EMPTY_GLOSSARY_SET;
  } catch {
    return EMPTY_GLOSSARY_SET;
  }
}

export function saveGlossary(
  glossary: GlossarySet,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(GLOSSARY_KEY, JSON.stringify(glossary));
}
