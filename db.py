import os
import json
import sqlite3
from typing import Dict, Any, List, Optional
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge.db")

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize SQLite tables as specified in PROJECT_SPEC.md."""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Reels Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS reels (
            id TEXT PRIMARY KEY,
            source_url TEXT UNIQUE NOT NULL,
            title TEXT,
            author TEXT,
            duration_seconds REAL,
            raw_transcript TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # 2. Verifications Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reel_id TEXT REFERENCES reels(id),
            tech_name TEXT NOT NULL,
            claimed_features TEXT,
            verdict TEXT NOT NULL,
            github_url TEXT,
            pricing_model TEXT,
            summary_markdown TEXT,
            evidence_sources TEXT
        );
        """)

        # 3. Chat Messages Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reel_id TEXT REFERENCES reels(id),
            sender TEXT NOT NULL,
            message_text TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        conn.commit()

def save_reel_and_verification(
    reel_meta: Dict[str, Any],
    transcript: str,
    fact_check: Dict[str, Any],
    claimed_features: List[str]
) -> None:
    """Save reel metadata and fact-check results to SQLite database."""
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Upsert Reel
        cursor.execute("""
        INSERT INTO reels (id, source_url, title, author, duration_seconds, raw_transcript)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            author=excluded.author,
            duration_seconds=excluded.duration_seconds,
            raw_transcript=excluded.raw_transcript;
        """, (
            reel_meta["id"],
            reel_meta["source_url"],
            reel_meta.get("title", ""),
            reel_meta.get("author", ""),
            reel_meta.get("duration_seconds", 0.0),
            transcript
        ))

        # Delete existing verification for this reel if any
        cursor.execute("DELETE FROM verifications WHERE reel_id = ?", (reel_meta["id"],))

        # Insert Verification
        cursor.execute("""
        INSERT INTO verifications (
            reel_id, tech_name, claimed_features, verdict, github_url, pricing_model, summary_markdown, evidence_sources
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            reel_meta["id"],
            fact_check.get("tech_name", "Unknown"),
            json.dumps(claimed_features),
            fact_check.get("verdict", "UNKNOWN"),
            fact_check.get("github_url"),
            fact_check.get("pricing_model", "Unknown"),
            fact_check.get("summary_markdown", ""),
            json.dumps(fact_check.get("sources", []))
        ))
        conn.commit()

def get_reel(reel_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve full record for a reel including verification."""
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT r.*, v.tech_name, v.verdict, v.claimed_features, v.github_url, v.pricing_model, v.summary_markdown, v.evidence_sources
        FROM reels r
        LEFT JOIN verifications v ON r.id = v.reel_id
        WHERE r.id = ?;
        """, (reel_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
    return None

def list_all_reels() -> List[Dict[str, Any]]:
    """List all saved reels."""
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT r.id, r.title, r.author, r.source_url, v.tech_name, v.verdict, r.created_at
        FROM reels r
        LEFT JOIN verifications v ON r.id = v.reel_id
        ORDER BY r.created_at DESC;
        """)
        return [dict(r) for r in cursor.fetchall()]

def save_chat_message(reel_id: str, sender: str, message: str) -> None:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO chat_messages (reel_id, sender, message_text) VALUES (?, ?, ?);", (reel_id, sender, message))
        conn.commit()

def get_chat_history(reel_id: str) -> List[Dict[str, Any]]:
    init_db()
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sender, message_text, timestamp FROM chat_messages WHERE reel_id = ? ORDER BY id ASC;", (reel_id,))
        return [dict(r) for r in cursor.fetchall()]

if __name__ == "__main__":
    init_db()
    print("Database initialized at:", DB_PATH)
    print("Existing records:", len(list_all_reels()))
