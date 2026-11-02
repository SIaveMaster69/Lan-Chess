@echo off
title LAN Chess server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
pause
