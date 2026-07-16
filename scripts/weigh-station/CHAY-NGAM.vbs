' Chay agent tram can AN (khong cua so) - KHONG can quyen admin.
' Nhay dup file nay de chay ngam ngay; muon tu chay khi bat may: tao shortcut
' cua file nay roi keo vao thu muc Startup (Win+R -> shell:startup).
' Dung agent: Task Manager -> tab Details -> tim powershell.exe -> End task.
Set fso = CreateObject("Scripting.FileSystemObject")
dir_ = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("Wscript.Shell").Run """" & dir_ & "\CHAY-AGENT.bat""", 0, False
