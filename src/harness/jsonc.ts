import fs from "node:fs/promises";

export function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    const next = text[i + 1] ?? "";

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
    } else {
      output += char;
    }
  }

  return output;
}

export function parseJsonC<T = unknown>(text: string): T {
  const clean = stripJsonComments(text).replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(clean) as T;
}

export async function readJsonCFile<T extends object>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = (await fs.readFile(filePath, "utf8")).trim();
    if (!text) return fallback;
    return parseJsonC<T>(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writePrettyJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
