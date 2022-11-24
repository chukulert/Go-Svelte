scp 192.168.0.2:C:/Users/commonuser/Desktop/bin_repo/frontend.gz 192.168.0.3:/C:/Users/commonuser/Desktop/fe_deployed

ssh $args[0] "cd C:\Users\commonuser\Desktop\fe_deployed && tar -xvf frontend.gz"

ssh $args[0] "cd C:\Users\commonuser\Desktop\fe_deployed\deploy && "powershell -Command ".\deploy.ps1"