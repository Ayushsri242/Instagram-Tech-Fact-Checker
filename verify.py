import os
import re
import json
from typing import Dict, Any, List
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
FALLBACK_MODEL = "openai/gpt-oss-20b"

def get_groq_client() -> Groq:
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not set in environment or .env file.")
    return Groq(api_key=GROQ_API_KEY)

def _call_groq_json(client: Groq, messages: list) -> str:
    for model in [MODEL_NAME, FALLBACK_MODEL, "qwen/qwen3.6-27b"]:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"Model {model} failed ({e}), attempting fallback...")
    raise RuntimeError("All Groq models failed to complete request.")

def extract_claims_and_queries(transcript: str, ocr_text: str = "") -> Dict[str, Any]:
    """
    Use Groq LLM to extract key technologies, claims, and search queries from audio transcript and on-screen text.
    Handles both single-tool reels and multi-tool carousels/lists.
    """
    client = get_groq_client()
    
    prompt = f"""
Analyze this content from a tech video/Instagram reel/carousel post.
You are given both the Audio Transcript (or post caption) and all On-Screen Text/Visuals detected from the video frames/slides.

Audio Transcript / Caption:
\"\"\"{transcript}\"\"\"

On-Screen Text / Visuals Detected from Frames/Slides:
\"\"\"{ocr_text}\"\"\"

Task:
1. Determine if this post is about a SINGLE tool/technique or MULTIPLE tools/libraries (e.g. "5 LLM Libraries", listicle carousel).
2. Extract all distinct tools/libraries/frameworks mentioned or shown on screen. Look specifically for GitHub repo names (e.g., 'owner/repo', 'VectifyAI/PageIndex', 'confident-ai/deepteam'), pip package names, and domain URLs.
3. Generate precise DuckDuckGo search queries. If GitHub repo or pip package names are present, include queries like "owner/repo github" or "pip install packagename".

Respond ONLY with valid JSON in this exact structure:
{{
  "tech_name": "Primary title or main tool name (e.g. '5 LLM Libraries' or 'PageIndex')",
  "is_multi_tool": true,
  "tools": [
    {{
      "name": "Tool Name",
      "github_repo": "owner/repo or null",
      "pip_command": "pip install ... or null",
      "claim": "Core feature or claim stated"
    }}
  ],
  "claimed_features": ["claim 1", "claim 2"],
  "search_queries": ["query 1", "query 2"]
}}
"""
    messages = [
        {"role": "system", "content": "You are an expert technical entity and claim extraction system. Output strictly valid JSON."},
        {"role": "user", "content": prompt}
    ]
    content = _call_groq_json(client, messages)
    data = json.loads(content)
    
    # Enrich search queries with any explicit github repo strings found in OCR or LLM tools
    queries = data.get("search_queries", [])
    
    # Auto-detect owner/repo patterns in OCR text
    ocr_repo_slugs = re.findall(r'\b([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)\b', ocr_text)
    for slug in ocr_repo_slugs:
        if "/" in slug and not slug.startswith("http") and not slug.startswith("pip/") and not slug.startswith("api/"):
            if f"{slug} github" not in queries:
                queries.insert(0, f"{slug} github")

    for tool in data.get("tools", []):
        repo = tool.get("github_repo")
        if repo and repo != "null" and f"{repo} github" not in queries:
            queries.insert(0, f"{repo} github")
        name = tool.get("name")
        if name and f"{name} python library github" not in queries:
            queries.append(f"{name} python library github")
    data["search_queries"] = queries[:10]
    return data

VERDICTS = ["TRUE", "PARTIALLY_TRUE", "HYPE", "MISLEADING", "FAKE"]


def _clean_list(value, limit=12):
    """Coerce whatever the model returned into a list of non-empty strings."""
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if isinstance(item, dict):
            item = item.get("text") or item.get("claim") or item.get("value") or ""
        text = str(item).strip().lstrip("-*").strip()
        # The prompt asks for plain sentences, but asking is not enforcing:
        # strip leftover emphasis and heading marks so the renderer stays the
        # only thing that decides formatting.
        text = re.sub(r"\*{1,3}|`{1,3}|^#{1,6}\s*", "", text).strip()
        if text and text.lower() not in ("none", "null", "n/a") and text not in out:
            out.append(text)
    return out[:limit]


def render_summary_markdown(data, evidence):
    """
    Build the report in code rather than asking the model for markdown.

    Markdown inside a JSON string field means the model has to hand-escape every
    newline, which is the same failure that produced a literal "\\n" in the
    mobile app's stage-3 output. Asking for fields and formatting here removes
    that whole class of bug, and guarantees every section is present.
    """
    lines = []
    verdict = data.get("verdict", "UNKNOWN")
    lines.append("## Verdict: {}".format(verdict))
    lines.append("")

    claims = _clean_list(data.get("claims"))
    if claims:
        lines.append("### What was claimed")
        lines.extend("- {}".format(c) for c in claims)
        lines.append("")

    reality = str(data.get("factual_reality", "")).strip()
    if reality:
        lines.append("### Practical reality")
        lines.append(reality)
        lines.append("")

    tools = data.get("tools")
    if isinstance(tools, list) and tools:
        lines.append("### Tools")
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = str(tool.get("name", "")).strip()
            if not name:
                continue
            status = str(tool.get("status", "")).strip().lower()
            marker = {"verified": " (verified)", "not_found": " (NOT FOUND)"}.get(status, "")
            lines.append("**{}**{}".format(name, marker))
            repo = str(tool.get("repo") or "").strip()
            if repo and repo.lower() != "null":
                url = repo if repo.startswith("http") else "https://github.com/{}".format(repo)
                lines.append("- Repo: {}".format(url))
            install = str(tool.get("install") or "").strip()
            if install and install.lower() != "null":
                lines.append("- Install: `{}`".format(install))
            does = str(tool.get("what_it_does") or "").strip()
            if does:
                lines.append("- What it does: {}".format(does))
            caveat = str(tool.get("caveat") or "").strip()
            if caveat and caveat.lower() not in ("null", "none"):
                lines.append("- Caveat: {}".format(caveat))
            lines.append("")

    gotchas = _clean_list(data.get("gotchas"))
    if gotchas:
        lines.append("### Gotchas and caveats")
        lines.extend("- {}".format(g) for g in gotchas)
        lines.append("")

    # References come from the evidence we actually fetched, never from the
    # model, which will happily invent a plausible-looking URL.
    if evidence:
        lines.append("### References")
        seen = set()
        rank = 0
        for item in evidence:
            url = (item.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            rank += 1
            title = (item.get("title") or url).strip()
            lines.append("{}. [{}]({})".format(rank, title, url))
            if rank >= 8:
                break
        lines.append("")

    return "\n".join(lines).strip()


def synthesize_fact_check(transcript: str, claims_data: Dict[str, Any], evidence: List[Dict[str, Any]], ocr_text: str = "") -> Dict[str, Any]:
    """
    Cross-reference video claims with web research evidence and produce a structured fact-check report.
    Supports both single-tool deep dives and multi-tool roundup carousels.

    The model returns fields only. The markdown report is rendered here, so the
    output shape is guaranteed regardless of how well the model behaves.
    """
    client = get_groq_client()

    evidence_text = "\n".join([
        f"- Title: {e.get('title')}\n  URL: {e.get('url')}\n  Snippet: {e.get('snippet')}\n  Page Context: {e.get('page_preview', '')[:400]}"
        for e in evidence
    ])

    prompt = f"""
You are a senior Applied AI and Software Engineer acting as a practical, objective Fact-Checker for social media tech videos and posts.

Analyze the claims made in the video transcript/caption and on-screen visuals against the collected real-world web evidence.

Content Context:
- Audio/Caption: \"\"\"{transcript}\"\"\"
- Visual/OCR Text: \"\"\"{ocr_text}\"\"\"
- Extracted Claims & Tools: {json.dumps(claims_data, indent=2)}
- Web Evidence Gathered:
\"\"\"{evidence_text}\"\"\"

Evaluation Principles:
- If MULTI-TOOL list (e.g. 5 tools): check each tool against the evidence and return one entry per tool in "tools". If real GitHub repositories / pip packages exist, the verdict should reflect their collective authenticity.
- If SINGLE-TOOL: evaluate the single tool deeply and return one entry in "tools".
- Practical Utility First: if a shorthand trick or prompt (e.g. "/eli5") actually produces the claimed result in practice because the AI understands the intent, mark it TRUE or PARTIALLY_TRUE and explain prompt semantics vs a native command.
- Ground every tool entry in the evidence above. Set "status" to "verified" only when the evidence actually shows the repo or package exists. Use "not_found" when you looked and the evidence does not support it. Never invent a repo, install command or URL.

Verdict Options: {VERDICTS}
  * TRUE: Tools/repos exist, are open-source / usable, and work as demonstrated.
  * PARTIALLY_TRUE: Real tools/repos exist, but with minor technical caveats (early alpha, semantic shortcut, setup prerequisites).
  * HYPE: Underlying concept exists, but marketing claims ("100% replaces everything", "zero effort") are exaggerated.
  * MISLEADING: Omits critical limitations, severe pricing catches, or misrepresents functionality.
  * FAKE: Completely fabricated tools, non-existent repos, or malicious scams.

Return FIELDS ONLY. Do not write markdown, headings, bullet characters or emoji
in any value. Each list item must be one plain sentence. The report is assembled
by the application from these fields.

Respond ONLY with valid JSON in this exact structure:
{{
  "tech_name": "{claims_data.get('tech_name', 'Tech Tools')}",
  "verdict": "PARTIALLY_TRUE",
  "pricing_model": "Open Source",
  "github_url": "https://github.com/owner/repo or null",
  "factual_reality": "2-4 sentence technical explanation of what actually happens in reality vs what was claimed.",
  "claims": ["one plain sentence per claim made in the post"],
  "tools": [
    {{
      "name": "Tool Name",
      "repo": "owner/repo or null",
      "install": "pip install something or null",
      "what_it_does": "one plain sentence",
      "caveat": "one plain sentence or null",
      "status": "verified"
    }}
  ],
  "gotchas": ["one plain sentence per caveat: rate limits, prerequisites, early-stage repos"]
}}
"""
    messages = [
        {"role": "system", "content": "You are a precise, objective AI technical fact checker. Output strictly valid JSON with no markdown inside any field."},
        {"role": "user", "content": prompt}
    ]
    content = _call_groq_json(client, messages)
    data = json.loads(content)

    # The model is allowed to be sloppy; the record we hand on is not.
    if data.get("verdict") not in VERDICTS:
        data["verdict"] = "UNKNOWN"
    data["tech_name"] = data.get("tech_name") or claims_data.get("tech_name") or "Unknown"
    data["claims"] = _clean_list(data.get("claims")) or _clean_list(claims_data.get("claimed_features"))
    data["gotchas"] = _clean_list(data.get("gotchas"))
    data["factual_reality"] = str(data.get("factual_reality", "")).strip()
    if not isinstance(data.get("tools"), list):
        data["tools"] = []

    # Sources are what we actually fetched, so they cannot be hallucinated.
    data["sources"] = []
    for item in evidence:
        url = (item.get("url") or "").strip()
        if url and url not in data["sources"]:
            data["sources"].append(url)

    data["summary_markdown"] = render_summary_markdown(data, evidence)

    if not data["factual_reality"]:
        # A report with no reasoning is not a fact-check. Say so rather than
        # shipping a confident-looking empty section.
        data["factual_reality"] = (
            "The model did not return an explanation for this verdict. "
            "Treat the verdict below as unconfirmed."
        )
        data["summary_markdown"] = render_summary_markdown(data, evidence)

    return data


if __name__ == "__main__":
    test_transcript = "Bhai RAG is dead in 2026. Google has changed the game with a new open knowledge format where your PDF is converted into clean .md with explicit links instead of vector database."
    print("Testing claim extraction...")
    claims = extract_claims_and_queries(test_transcript)
    print("Extracted claims:", json.dumps(claims, indent=2))
