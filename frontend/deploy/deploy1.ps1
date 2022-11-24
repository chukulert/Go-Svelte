# $processPID = $($(netstat -aon | findstr :3001)[0] -split '\s+')[-1]

# tskill $processPID

cd C:\Users\commonuser\Desktop\fe_test

tar -czf prev.gz .\.

Copy-Item -Path "C:\Users\commonuser\Desktop\fe_test\prev.gz" -Destination "C:\Users\commonuser\Desktop\fe_temp"

# del C:\Users\commonuser\Desktop\fe_test\*
# del C:\Users\commonuser\Desktop\fe_test\main

mkdir C:\Users\commonuser\Desktop\fe_test\main

Copy-Item -Path "C:\Users\commonuser\Desktop\fe_deployed\frontend.gz" -Destination "C:\Users\commonuser\Desktop\fe_test\main"

cd c:\Users\commonuser\Desktop\fe_test\main

tar -xf frontend.gz

cd c:\Users\commonuser\Desktop\fe_test\main

Start-Process -NoNewWindow node server.js
