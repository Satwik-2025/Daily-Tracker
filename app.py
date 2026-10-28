"""Daily Tracker - a small Flask app for daily habits, a timetable and monthly progress.

Run it with:  python app.py   then open http://127.0.0.1:5000
"""

import calendar
import os
import sqlite3
from datetime import date, datetime

from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tracker.db")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------- database ---

def get_db():
    """Open one SQLite connection per request."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create the tables the first time the app runs."""
    with sqlite3.connect(DATABASE) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                created_on  TEXT NOT NULL,          -- first day the task counts
                archived_on TEXT                    -- first day it no longer counts
            );

            CREATE TABLE IF NOT EXISTS logs (
                task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                log_date TEXT NOT NULL,
                status   TEXT CHECK (status IN ('done', 'missed')),
                remark   TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (task_id, log_date)
            );

            CREATE TABLE IF NOT EXISTS events (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                start_time TEXT NOT NULL,           -- 'HH:MM'
                end_time   TEXT NOT NULL,           -- 'HH:MM'
                weekday    INTEGER,                 -- 0=Mon..6=Sun for weekly entries
                event_date TEXT,                    -- 'YYYY-MM-DD' for one-day entries
                task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL
            );
            """
        )


# ----------------------------------------------------------------- helpers ---

def parse_date(value):
    """Return a date from 'YYYY-MM-DD', or None if it is missing/invalid."""
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def valid_time(value):
    try:
        datetime.strptime(value, "%H:%M")
        return True
    except (TypeError, ValueError):
        return False


def bad_request(message):
    return jsonify({"error": message}), 400


def active_tasks(db, day):
    """Tasks that existed on `day` and were not removed yet."""
    return db.execute(
        """SELECT * FROM tasks
           WHERE created_on <= ? AND (archived_on IS NULL OR archived_on > ?)
           ORDER BY id""",
        (day, day),
    ).fetchall()


def event_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "start": row["start_time"],
        "end": row["end_time"],
        "weekday": row["weekday"],
        "date": row["event_date"],
        "task_id": row["task_id"],
        "repeats": row["weekday"] is not None,
    }


def events_on(db, day):
    """Everything on the timetable for one date: weekly entries + one-day entries."""
    rows = db.execute(
        """SELECT * FROM events WHERE weekday = ? OR event_date = ?
           ORDER BY start_time, end_time""",
        (day.weekday(), day.isoformat()),
    ).fetchall()
    return [event_to_dict(r) for r in rows]


def find_conflicts(db, start, end, weekday=None, event_date=None):
    """Return existing entries that overlap the requested time slot.

    Two slots overlap when one starts before the other ends.
    """
    if event_date is not None:
        candidates = events_on(db, event_date)
    else:
        # A weekly entry clashes with other weekly entries on that weekday and
        # with upcoming one-day entries that fall on the same weekday.
        today = date.today().isoformat()
        rows = db.execute(
            "SELECT * FROM events WHERE weekday = ? OR event_date >= ?",
            (weekday, today),
        ).fetchall()
        candidates = [
            event_to_dict(r) for r in rows
            if r["weekday"] == weekday
            or (r["event_date"] and parse_date(r["event_date"]).weekday() == weekday)
        ]
    return [e for e in candidates if start < e["end"] and e["start"] < end]


# ------------------------------------------------------------------- pages ---

@app.route("/")
def index():
    return render_template("index.html")


# ------------------------------------------------------------------- tasks ---

@app.get("/api/tasks")
def list_tasks():
    """Tasks for one day together with what was logged for them."""
    day = parse_date(request.args.get("date"))
    if day is None:
        return bad_request("date must look like YYYY-MM-DD")
    db = get_db()
    day_str = day.isoformat()
    logs = {
        r["task_id"]: r
        for r in db.execute("SELECT * FROM logs WHERE log_date = ?", (day_str,))
    }
    slots = {}
    for e in events_on(db, day):
        if e["task_id"] is not None:
            slots.setdefault(e["task_id"], []).append(e)
    tasks = []
    for t in active_tasks(db, day_str):
        log = logs.get(t["id"])
        tasks.append({
            "id": t["id"],
            "name": t["name"],
            "status": log["status"] if log else None,
            "remark": log["remark"] if log else "",
            "slots": slots.get(t["id"], []),
        })
    return jsonify(tasks)


@app.post("/api/tasks")
def add_task():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    start = parse_date(data.get("start_date"))
    if not name:
        return bad_request("Task name cannot be empty")
    if start is None:
        return bad_request("start_date must look like YYYY-MM-DD")
    db = get_db()
    cur = db.execute(
        "INSERT INTO tasks (name, created_on) VALUES (?, ?)", (name, start.isoformat())
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.delete("/api/tasks/<int:task_id>")
def remove_task(task_id):
    """Stop tracking a task from `date` onwards. Old days keep their history."""
    day = parse_date(request.args.get("date"))
    if day is None:
        return bad_request("date must look like YYYY-MM-DD")
    db = get_db()
    task = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if task is None:
        return jsonify({"error": "Task not found"}), 404
    if task["created_on"] >= day.isoformat():
        # Never counted on any earlier day, so there is no history to keep.
        db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    else:
        db.execute("UPDATE tasks SET archived_on = ? WHERE id = ?", (day.isoformat(), task_id))
    db.commit()
    return jsonify({"ok": True})


# -------------------------------------------------------------------- logs ---

@app.post("/api/logs")
def save_logs():
    """Save the ticks, crosses and remarks for one day."""
    data = request.get_json(silent=True) or {}
    day = parse_date(data.get("date"))
    today = parse_date(data.get("today")) or date.today()
    if day is None:
        return bad_request("date must look like YYYY-MM-DD")
    if day > today:
        return bad_request("You can't log a day that hasn't happened yet")
    db = get_db()
    for entry in data.get("entries", []):
        status = entry.get("status")
        if status not in ("done", "missed", None):
            return bad_request("status must be 'done', 'missed' or empty")
        db.execute(
            """INSERT INTO logs (task_id, log_date, status, remark) VALUES (?, ?, ?, ?)
               ON CONFLICT (task_id, log_date)
               DO UPDATE SET status = excluded.status, remark = excluded.remark""",
            (entry.get("task_id"), day.isoformat(), status, (entry.get("remark") or "").strip()),
        )
    db.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------- month ---

@app.get("/api/month")
def month_view():
    """Tick/cross grid for every task in a month, plus completion percentages."""
    try:
        year = int(request.args["year"])
        month = int(request.args["month"])
        first = date(year, month, 1)
    except (KeyError, ValueError):
        return bad_request("year and month are required")
    today = parse_date(request.args.get("today")) or date.today()
    days_in_month = calendar.monthrange(year, month)[1]
    last = date(year, month, days_in_month)
    db = get_db()

    tasks = db.execute(
        """SELECT * FROM tasks
           WHERE created_on <= ? AND (archived_on IS NULL OR archived_on > ?)
           ORDER BY id""",
        (last.isoformat(), first.isoformat()),
    ).fetchall()
    logs = {
        (r["task_id"], r["log_date"]): r
        for r in db.execute(
            "SELECT * FROM logs WHERE log_date BETWEEN ? AND ?",
            (first.isoformat(), last.isoformat()),
        )
    }

    rows, total_done, total_marked, total_unlogged = [], 0, 0, 0
    for t in tasks:
        cells, done, marked = [], 0, 0
        for d in range(1, days_in_month + 1):
            day = date(year, month, d)
            key = day.isoformat()
            counts = t["created_on"] <= key and (t["archived_on"] is None or t["archived_on"] > key)
            log = logs.get((t["id"], key))
            if not counts or day > today:
                cells.append({"state": "na"})
                continue
            status = log["status"] if log else None
            cells.append({
                "state": status or "empty",
                "remark": log["remark"] if log else "",
            })
            if status == "done":
                done += 1
            if status:
                marked += 1
            else:
                total_unlogged += 1
        total_done += done
        total_marked += marked
        rows.append({
            "id": t["id"],
            "name": t["name"],
            "cells": cells,
            "done": done,
            "marked": marked,
            "percent": round(100 * done / marked) if marked else None,
        })

    return jsonify({
        "year": year,
        "month": month,
        "month_name": first.strftime("%B %Y"),
        "days": days_in_month,
        "first_weekday": first.weekday(),
        "tasks": rows,
        "done": total_done,
        "marked": total_marked,
        "unlogged": total_unlogged,
        "percent": round(100 * total_done / total_marked) if total_marked else None,
    })


# --------------------------------------------------------------- timetable ---

@app.get("/api/week")
def week_view():
    """Seven days of timetable starting at `start`."""
    start = parse_date(request.args.get("start"))
    if start is None:
        return bad_request("start must look like YYYY-MM-DD")
    db = get_db()
    days = []
    for offset in range(7):
        day = date.fromordinal(start.toordinal() + offset)
        days.append({
            "date": day.isoformat(),
            "weekday": WEEKDAYS[day.weekday()],
            "events": events_on(db, day),
        })
    return jsonify(days)


@app.post("/api/events")
def add_event():
    """Add a timetable entry. Refuses (409) if the slot is already taken,
    unless the request says force=true."""
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    start, end = data.get("start"), data.get("end")
    weekday = data.get("weekday")
    event_date = parse_date(data.get("date")) if data.get("date") else None
    task_id = data.get("task_id")

    if not title:
        return bad_request("Give the entry a name")
    if not (valid_time(start) and valid_time(end)):
        return bad_request("Times must look like HH:MM")
    if start >= end:
        return bad_request("End time must be after start time")
    if (weekday is None) == (event_date is None):
        return bad_request("Choose either a weekday (every week) or a single date")
    if weekday is not None and weekday not in range(7):
        return bad_request("weekday must be 0 (Monday) to 6 (Sunday)")

    db = get_db()
    conflicts = find_conflicts(db, start, end, weekday=weekday, event_date=event_date)
    if conflicts and not data.get("force"):
        return jsonify({"error": "That time is already taken", "conflicts": conflicts}), 409

    cur = db.execute(
        """INSERT INTO events (title, start_time, end_time, weekday, event_date, task_id)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (title, start, end, weekday, event_date.isoformat() if event_date else None, task_id),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.delete("/api/events/<int:event_id>")
def delete_event(event_id):
    db = get_db()
    db.execute("DELETE FROM events WHERE id = ?", (event_id,))
    db.commit()
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(debug=True)
