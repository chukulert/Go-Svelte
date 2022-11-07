$statusCode = wget http://192.168.0.3:3001/ | % {$_.StatusCode}
$statusCode