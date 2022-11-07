#!/bin/bash
cd "C:/Users/commonuser/Desktop/buildspace/Ff-pHdWJ/0/gitlab-instance-1f5f55d9/"

tar -cvzf frontend.gz .\frontend\

ssh commonuser@192.168.0.3
"scp 192.168.0.2:C:/Users/commonuser/Desktop/bin_repo/frontend.gz 192.168.0.3:/C:/Users/commonuser/Desktop/deployed"