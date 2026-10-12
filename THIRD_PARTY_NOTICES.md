# Third-party notices

## Canvas MCP

- Source: https://github.com/vishalsachdev/canvas-mcp
- Tag: v1.14.0
- Commit: 4696c166722becf7608f1f197a0c72c83048d224
- License: MIT, Copyright (c) 2025 Vishal Sachdev.
- Included: unmodified `src/`, `tools/`, `pyproject.toml`, `uv.lock`, upstream README and LICENSE under `vendor/canvas-mcp/`.
- Local selection: student/shared profile with upstream read-only policy gates; no modification to upstream source.

The runtime dependencies are installed from the lock files and are not distributed as virtual environments. Their own licenses remain applicable.

## Legacy Canvas adapter

The locally developed narrow adapter under `legacy/canvas-insearch/` is included as source. The dashboard only allows its three read tools; its two assignment mutation tools remain disabled in the dashboard.

## FullCalendar

- Source: https://github.com/fullcalendar/fullcalendar
- Version: 7.1.1
- Official distribution: https://cdn.jsdelivr.net/npm/fullcalendar@7.1.1/
- License: MIT, Copyright (c) 2026 Adam Shaw.
- Included: standard browser-global bundle, Monarch theme and stylesheets under `static/vendor/fullcalendar/`; license and source mapping are included there.
- These assets are served locally; the workspace does not load the calendar from a CDN at runtime.
- Schedule-X is a visual reference only; its code is not included.
