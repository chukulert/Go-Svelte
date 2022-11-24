#!/bin/bash
cd "C:/Users/commonuser/Desktop/buildspace/Ff-pHdWJ/0/gitlab-instance-1f5f55d9/frontend/"

npm install

npm run build

ls

tar -czf frontend.gz ./config ./public ./deploy ./package.json ./server.js ./node_modules

mv C:/Users/commonuser/Desktop/buildspace/Ff-pHdWJ/0/gitlab-instance-1f5f55d9/frontend/frontend.gz C:/Users/commonuser/Desktop/bin_repo

