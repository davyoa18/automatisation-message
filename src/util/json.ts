/** Les objets JSON équilibrés de premier niveau d'un texte, dans l'ordre (chaînes et échappements respectés). */
function topLevelObjects(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

/** Extrait un objet JSON d'un texte (réponse brute, bloc ```json, ou objet noyé dans du texte). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* on cherche plus loin */
  }
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].reverse();
  for (const fence of fences) {
    try {
      return JSON.parse(fence[1] ?? "");
    } catch {
      /* bloc suivant */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* dernier recours ci-dessous */
    }
  }
  for (const candidate of topLevelObjects(trimmed).reverse()) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* objet suivant */
    }
  }
  throw new Error("Réponse sans JSON exploitable");
}
