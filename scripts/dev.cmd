@echo off
rem Thin wrapper so `scripts\dev` works from cmd.exe.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
