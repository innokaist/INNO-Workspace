# User development workspace preference

The user explicitly requested on 2026-09-13 that development performed through this desktop app use `E:\Develop` instead of `C:\Users\WonJeong Yu\Documents`.

- Create new development projects and their working files under `E:\Develop\<project-name>`.
- Keep project source, generated development artifacts, and project-local temporary files inside that project directory where practical.
- Do not start a new development project under Documents merely because it is the current working directory.
- This location preference does not itself authorize deleting or relocating existing projects. Coordinate any necessary migration with the user's task and preserve existing work.

This Windows path preference applies to desktop development only. In Claude cloud routines or other non-Windows runtimes, use the checked-out repository and runtime-provided working directory; do not create or reference an E: drive.

# Independent platform requirement

The user clarified on 2026-09-21 that INNO Workspace must be a complete, independent platform. NanoLab, Prism, RefAtlas, Scheduler, Analytics, and Ledger are optional tools or data sources, used only when useful for a particular request.

- Do not require another INNO app, its installation, account, database, file schema, or connection for core task creation, execution, orchestration, history, or artifact handling.
- Master planning starts from the user's objective and available evidence, not a fixed NanoLab/Prism workflow.
- Keep app-specific adapters separate from the core. Missing or failed optional connections must not block unrelated work.
- Accept ordinary connected files and general requests without requiring an app-specific export.
- Describe existing integrations as optional conveniences. Do not silently remove them or migrate their data.
- Include an all-optional-integrations-disconnected scenario in core end-to-end verification.
