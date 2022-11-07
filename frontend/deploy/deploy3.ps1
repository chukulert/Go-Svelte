- $headers.Add("Content-Type", "application/json") 

        $body = "{
        `n     `"username`": `"admin`",
        `n     `"password`": `"admin@123`"
        `n}" 

        $response = Invoke-RestMethod 'http://localhost:8080/authenticate' -Method 'POST' -Headers $headers -Body $body 
        $response | ConvertTo-Json