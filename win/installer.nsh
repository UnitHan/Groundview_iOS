; electron-builder NSIS custom hooks for GroundView iOS (Windows).
; Registers the background tunneld task on install and removes it on uninstall.
; Bundled tools are expected at:  $INSTDIR\resources\win\tools\pymobiledevice3.exe
; (populate win\tools\ before building — see win\WINDOWS_TODO.md).

!macro customInstall
  DetailPrint "Registering GroundView tunneld background task..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\win\install-tunneld-service.ps1" -Pmd3 "$INSTDIR\resources\win\tools\pymobiledevice3.exe"'
  Pop $0
  DetailPrint "tunneld registration exit code: $0"
!macroend

!macro customUnInstall
  DetailPrint "Removing GroundView tunneld background task..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName GroundViewTunneld -Confirm:$false -ErrorAction SilentlyContinue"'
  Pop $0
!macroend
