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

def synthesize_fact_check(transcript: str, claims_data: Dict[str, Any], evidence: List[Dict[str, Any]], ocr_text: str = "") -> Dict[str, Any]:
    """
    Cross-reference video claims with web research evidence and produce a structured fact-check report.
    Supports both single-tool deep dives and multi-tool roundup carousels.
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
- If MULTI-TOOL list (e.g. 5 tools): Check each tool against evidence. If real GitHub repositories / pip packages exist for the tools, verdict should reflect their collective authenticity (e.g. TRUE or PARTIALLY_TRUE). In the summary, provide a concise bulleted breakdown for EVERY tool with its repo, practical utility, and caveats.
- If SINGLE-TOOL: Evaluate the single tool deeply.
- Practical Utility First: If a shorthand trick or prompt (e.g., "/eli5") actually produces the claimed result in practice because the AI understands the intent, mark it as TRUE or PARTIALLY_TRUE (explain prompt semantics vs native command).
- Verdict Options: ["TRUE", "PARTIALLY_TRUE", "HYPE", "MISLEADING", "FAKE"]
  * TRUE: Tools/repos exist, are open-source / usable, and work as demonstrated.
  * PARTIALLY_TRUE: Real tools/repos exist, but with minor technical caveats (e.g. early alpha, semantic shortcut, setup prerequisites).
  * HYPE: Underlying concept exists, but marketing claims (e.g. "100% replaces everything", "zero effort") are exaggerated.
  * MISLEADING: Omits critical limitations, severe pricing catches, or misrepresents functionality.
  * FAKE: Completely fabricated tools, non-existent repos, or malicious scams.

Determine:
1. verdict: Must be one of ["TRUE", "PARTIALLY_TRUE", "HYPE", "MISLEADING", "FAKE"]
2. factual_reality: A 2-4 sentence technical explanation of what actually happens in reality vs what was claimed.
3. github_url: Primary official repo URL or null (if multi-tool, list individual repos in markdown).
4. pricing_model: "Open Source" | "Free Tier" | "Freemium" | "Paid" | "Unknown"
5. summary_markdown: A clean, structured markdown report with:
   - 🎯 **Verdict**: [VERDICT]
   - 🔍 **What Was Claimed**: (bullet points)
   - 💡 **Practical Reality & Tool Breakdown**: (For multi-tool posts, provide a clear breakdown of each tool: Name, GitHub repo / link, pip command, and what it does)
   - ⚠️ **Gotchas / Caveats**: (e.g. early-stage repos, rate limits, prerequisites)
   - 🔗 **References**: (URLs from evidence)

Respond ONLY with valid JSON in this exact structure:
{{
  "tech_name": "{claims_data.get('tech_name', 'Tech Tools')}",
  "verdict": "TRUE",
  "pricing_model": "Open Source",
  "github_url": "https://github.com/...",
  "factual_reality": "string",
  "summary_markdown": "string",
  "sources": ["url1", "url2"]
}}
"""
    messages = [
        {"role": "system", "content": "You are a precise, objective AI technical fact checker. Output strictly valid JSON."},
        {"role": "user", "content": prompt}
    ]
    content = _call_groq_json(client, messages)
    return json.loads(content)


if __name__ == "__main__":
    test_transcript = "Bhai RAG is dead in 2026. Google has changed the game with a new open knowledge format where your PDF is converted into clean .md with explicit links instead of vector database."
    print("Testing claim extraction...")
    claims = extract_claims_and_queries(test_transcript)
    print("Extracted claims:", json.dumps(claims, indent=2))
