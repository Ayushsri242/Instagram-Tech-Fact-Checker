import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Any, Optional
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning)
try:
    from ddgs import DDGS
except ImportError:
    from duckduckgo_search import DDGS

def search_web(query: str, max_results: int = 4) -> List[Dict[str, str]]:
    """
    Search DuckDuckGo without API keys.
    Returns list of dicts with title, href, and body.
    """
    results: List[Dict[str, str]] = []
    try:
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
            for item in raw_results:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("href", "") or item.get("link", ""),
                    "snippet": item.get("body", "") or item.get("snippet", "")
                })
    except Exception as e:
        print(f"DuckDuckGo search error for '{query}': {e}")
    return results

def fetch_url_text(url: str, max_chars: int = 1200) -> str:
    """
    Scrape lightweight text content from URL.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            # Remove scripts and styles
            for elem in soup(["script", "style", "nav", "footer", "header"]):
                elem.extract()
            text = " ".join(soup.stripped_strings)
            return text[:max_chars]
    except Exception:
        pass
    return ""

def check_github_repo(slug: str) -> Optional[Dict[str, Any]]:
    """
    Directly verify if a GitHub repo (owner/repo) exists and fetch its live metadata.
    """
    clean_slug = slug.strip().strip("/").replace("https://github.com/", "").replace("http://github.com/", "")
    if "/" not in clean_slug or len(clean_slug.split("/")) != 2:
        return None
    
    headers = {"User-Agent": "Mozilla/5.0"}
    api_url = f"https://api.github.com/repos/{clean_slug}"
    try:
        resp = requests.get(api_url, headers=headers, timeout=4)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "query": f"github:{clean_slug}",
                "title": f"GitHub - {data.get('full_name')}",
                "url": data.get("html_url", f"https://github.com/{clean_slug}"),
                "snippet": f"⭐ Stars: {data.get('stargazers_count', 0)} | Description: {data.get('description', '')} | License: {data.get('license', {}).get('spdx_id', 'Open Source') if data.get('license') else 'Open Source'}",
                "page_preview": data.get("description", "")
            }
        # Fallback to direct page check
        html_url = f"https://github.com/{clean_slug}"
        resp_html = requests.get(html_url, headers=headers, timeout=4)
        if resp_html.status_code == 200 and "Page not found" not in resp_html.text:
            return {
                "query": f"github:{clean_slug}",
                "title": f"GitHub - {clean_slug}",
                "url": html_url,
                "snippet": f"Verified live GitHub repository: {html_url}",
                "page_preview": fetch_url_text(html_url, max_chars=600)
            }
    except Exception:
        pass
    return None

def gather_evidence_for_queries(queries: List[str]) -> List[Dict[str, Any]]:
    """
    Run searches for a list of queries and return enriched evidence.
    Automatically resolves direct GitHub slugs.
    """
    evidence = []
    seen_urls = set()

    for q in queries:
        # Check if query contains an explicit owner/repo
        words = q.split()
        for w in words:
            if "/" in w and not w.startswith("http") and not w.endswith("/"):
                direct_gh = check_github_repo(w)
                if direct_gh and direct_gh["url"] not in seen_urls:
                    seen_urls.add(direct_gh["url"])
                    evidence.append(direct_gh)

        search_res = search_web(q, max_results=4)
        for item in search_res:
            url = item["url"]
            if url and url not in seen_urls:
                seen_urls.add(url)
                page_text = fetch_url_text(url, max_chars=800) if "github.com" in url or "blog" in url or "docs" in url else ""
                evidence.append({
                    "query": q,
                    "title": item["title"],
                    "url": url,
                    "snippet": item["snippet"],
                    "page_preview": page_text
                })
    return evidence

if __name__ == "__main__":
    test_q = ["Google Open Knowledge format RAG", "Google markdown RAG alternative 2024 2025 2026"]
    print(f"Testing search for: {test_q}")
    ev = gather_evidence_for_queries(test_q)
    print(f"Found {len(ev)} evidence items:")
    for e in ev[:3]:
        print(f"\n- Title: {e['title']}\n  URL: {e['url']}\n  Snippet: {e['snippet'][:150]}...")
