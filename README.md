# Daily Tracker

A personal website to track your daily habits, plan your timetable and see your monthly progress.

- **Daily Tasks**: add habits any time ("Wake up at 7 AM", "Cold shower bath", "Gym"), mark each one ✓ or ✗ at the end of the day and write a remark ("woke up at 8", "did not go to gym"). The ⏰ button puts a task on today's timetable ("I'll do it from 4 to 5"). If something is already booked at that time, the app tells you what it is.
- **Timetable**: weekly entries (a class every Monday 9–10) and one-day entries. Clashes are detected and named ("There is already *Maths class* 4:00–5:00 PM").
- **Monthly View**: a table of ✓/✗ for each task and day, a % per task, and an overall % at the bottom (10 done out of 20 marked = **50%**).
- Everything is saved in a database file, so every past day is remembered.
- Glass-style buttons and cards. Works on phones too.

---

## 1. What we use and why

| Part | Tool | Why |
|---|---|---|
| Code editor | **VS Code** | Free, and the most popular beginner-friendly editor |
| Language (server) | **Python 3** | Easy to read, and you already know of it |
| Web framework | **Flask** | A tiny Python library that turns Python functions into web pages and a simple API |
| Database | **SQLite** | Built into Python. All your data lives in one file, `tracker.db`. Nothing to install |
| Page structure | **HTML** | What the browser shows |
| Looks | **CSS** | Colours, layout and the glass effect (`backdrop-filter: blur`) |
| Interaction | **JavaScript** (plain, no framework) | Buttons, switching pages, talking to Flask |

**Why not Streamlit?** Streamlit is great for data dashboards, but it is hard to give it custom glass buttons, clickable ✓/✗ cells and a custom timetable. **Why not React?** React is powerful but adds Node.js, npm and a build step. For a one-person app, plain HTML/CSS/JS plus Flask is simpler, and you can move to React later if you want.

How it fits together:

```
Browser (index.html + style.css + script.js)
        |  fetch("/api/...")   JSON
        v
Flask server (app.py)  ---->  SQLite file (tracker.db)
```

---

## 2. Install the tools (one time only)

1. **Python**: download from <https://www.python.org/downloads/> (3.10 or newer).
   On Windows, **tick "Add Python to PATH"** on the first screen of the installer.
2. **VS Code**: download from <https://code.visualstudio.com/>.
3. Open VS Code, go to the Extensions panel (the four squares on the left) and install **Python** (by Microsoft).
4. Check that Python works. In VS Code open **Terminal → New Terminal** and type:

   ```bash
   python --version
   ```

   On macOS/Linux use `python3` instead of `python` everywhere in this guide.

---

## 3. Create the project

1. Make a folder anywhere, e.g. `Documents/daily-tracker`.
2. In VS Code: **File → Open Folder…** and pick that folder.
3. Create this structure. Use the "New File" / "New Folder" icons in the Explorer panel. Folder names must be exactly `templates` and `static`, because Flask looks for those names:

   ```
   daily-tracker/
   ├── app.py              ← Python server + database
   ├── requirements.txt    ← list of Python libraries
   ├── .gitignore          ← files Git should skip (your database)
   ├── templates/
   │   └── index.html      ← the page and its three sections
   └── static/
       ├── style.css       ← glass design
       └── script.js       ← buttons, saving, page switching
   ```

4. Copy the contents of each file from this repository into your file with the same name.

---

## 4. Set up a virtual environment and install Flask

A *virtual environment* keeps this project's libraries separate from the rest of your computer.

In the VS Code terminal (it opens in your project folder):

**Windows**

```bash
python -m venv venv
```

```bash
venv\Scripts\activate
```

**macOS / Linux**

```bash
python3 -m venv venv
```

```bash
source venv/bin/activate
```

You should now see `(venv)` at the start of the terminal line. Then install Flask:

```bash
pip install -r requirements.txt
```

> If VS Code asks "We noticed a new environment, select it?", click **Yes**.
> Every time you reopen the project, run the `activate` command again before starting the app.

---

## 5. Run the website

```bash
python app.py
```

Open **<http://127.0.0.1:5000>** in your browser. To stop the server press **Ctrl + C** in the terminal.

The first run creates `tracker.db` next to `app.py`. That file **is** your data: copy it somewhere safe now and then as a backup.

---

## 6. How to use it

### Daily Tasks (home page)
1. Type a task, e.g. *Wake up at 7 AM*, and press **+ Add task**. Add as many as you like, any day. A new task counts from the day you add it.
2. At the end of the day, press **✓** (done) or **✗** (not done) for each task. Press it again to clear it.
3. Write remarks in the box under each task.
4. Changes **save automatically**. There is no save button to forget.
5. Use **◀ ▶** or the date box to fill in a day you missed. Future days are blocked.
6. **⏰** → "I'll do it from 16:00 to 17:00" → **Add to timetable**. If that slot is taken you will see e.g.
   *⚠️ That time is already taken: "Maths class" (4:00 PM – 5:00 PM, every week)*, and you can **pick another time** or **add anyway**.
7. **🗑** stops tracking a task from today. Past days keep their ticks and crosses.

### Timetable
- Choose **Every week on…** (classes, gym days) or **Only on one date…** (a one-off), set the times and press **+ Add**.
- Blue = repeats every week, orange = just that day. **×** deletes an entry. ◀ ▶ moves between weeks.

### Monthly View
- One row per task, one column per day: **✓** done, **✗** not done, **·** not marked yet, blank = the task didn't exist yet or the day is in the future.
- Hover over a ✓/✗ to see that day's remark.
- The last column is each task's %. The circle at the bottom is the whole month:
  **done ÷ (done + not done)**, e.g. 10 of 20 → 50%. Days you never marked (·) are listed separately and not counted.
  If you would rather count unmarked days as "not done", that is a one-line change in `month_view()` in `app.py`.

---

## 7. What each file does (so you can change things)

### `app.py`
- `init_db()` creates three tables:
  - `tasks`: your habits, with the day they start (`created_on`) and stop (`archived_on`) counting.
  - `logs`: one row per task per day: `done` / `missed`, plus the remark.
  - `events`: timetable entries, either a `weekday` (0 = Monday … 6 = Sunday) for weekly ones or an `event_date` for one-day ones.
- Routes starting with `/api/` send and receive JSON:
  - `GET /api/tasks?date=…`: tasks for a day with their ✓/✗ and remark
  - `POST /api/tasks`, `DELETE /api/tasks/<id>`: add or stop a task
  - `POST /api/logs`: save a day's ticks and remarks
  - `GET /api/month?year=…&month=…`: the monthly table and percentages
  - `GET /api/week?start=…`, `POST /api/events`, `DELETE /api/events/<id>`: the timetable
- `find_conflicts()` is the clash check: two slots overlap when `new_start < existing_end` **and** `existing_start < new_end`. If there is a clash, `POST /api/events` answers **409** with the list of clashing entries, unless you chose "Add anyway".

### `templates/index.html`
The header with the three glass buttons, and three `<section>`s: `page-daily`, `page-timetable`, `page-monthly`. Only one is visible at a time.

### `static/script.js`
- **Routing**: each button links to `#daily`, `#timetable` or `#monthly`. `showPage()` shows the matching section, so it all stays on one page and the browser's Back button still works.
- `loadDay()`, `loadWeek()` and `loadMonth()` fetch data from Flask and draw it.
- `saveDay()` auto-saves 0.6 s after you stop typing.

### `static/style.css`
The glass look comes from four lines on `.glass-btn` and `.glass-card`:

```css
background: rgba(255, 255, 255, 0.12);          /* see-through white */
border: 1px solid rgba(255, 255, 255, 0.28);    /* thin bright edge */
backdrop-filter: blur(12px);                    /* blur what's behind */
box-shadow: inset 0 1px 0 rgba(255,255,255,.35);/* light reflection on top */
```

The coloured `.blob`s behind the page give the blur something to show. Change the colours in `:root` at the top to re-theme everything.

---

## 8. Save your work with Git and GitHub (recommended)

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Daily tracker"
```

Then create an empty repository on GitHub and follow the "push an existing repository" commands it shows you. `.gitignore` keeps `tracker.db` (your personal data) and `venv/` out of GitHub.

---

## 9. Put it online so it works on your phone (optional, free)

The easiest free host for Flask + SQLite is **PythonAnywhere**:

1. Sign up at <https://www.pythonanywhere.com/> (free "Beginner" account).
2. **Consoles → Bash**, then run `git clone <your GitHub repo URL>`. You can also upload the files in the **Files** tab.
3. Install Flask in that console:

   ```bash
   pip install --user flask
   ```

4. **Web → Add a new web app → Manual configuration → Python 3.x**.
5. Under **Code**, set *Source code* to your project folder, then open the **WSGI configuration file** and replace its contents with:

   ```python
   import sys
   sys.path.insert(0, "/home/YOUR_USERNAME/daily-tracker")
   from app import app as application
   ```

6. Press **Reload**. Your site is now at `https://YOUR_USERNAME.pythonanywhere.com`.

> ⚠️ Once it is online, anyone with the link can see and edit it. Before sharing the link, add a password. The simplest way is HTTP Basic Auth on the **Web** tab of PythonAnywhere ("Password protection").

---

## 10. Ideas for later

- Streaks ("🔥 12 days in a row of cold showers")
- A reminder notification in the evening to fill in the day
- Export a month to Excel/CSV
- A chart of % per month across the year
- Login accounts if more people want to use it
