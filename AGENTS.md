# User development workspace preference

The user explicitly requested on 2026-09-13 that development performed through this desktop app use `E:\Develop` instead of `C:\Users\WonJeong Yu\Documents`.

- Create new development projects and their working files under `E:\Develop\<project-name>`.
- Keep project source, generated development artifacts, and project-local temporary files inside that project directory where practical.
- Do not start a new development project under Documents merely because it is the current working directory.
- This location preference does not itself authorize deleting or relocating existing projects. Coordinate any necessary migration with the user's task and preserve existing work.

This Windows path preference applies to desktop development only. In Claude cloud routines or other non-Windows runtimes, use the checked-out repository and runtime-provided working directory; do not create or reference an E: drive.
