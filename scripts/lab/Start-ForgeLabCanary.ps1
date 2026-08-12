#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BindAddress,
    [int]$Port = 47831,
    [Parameter(Mandatory)][string]$LogPath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ip = [Net.IPAddress]::Parse($BindAddress)
if ($ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'The canary must bind an IPv4 host-only address.'
}
$bytes = $ip.GetAddressBytes()
$private = $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
if (-not $private -or [Net.IPAddress]::IsLoopback($ip)) {
    throw 'The canary refuses wildcard, loopback, and non-private bind addresses.'
}

$log = [IO.Path]::GetFullPath($LogPath)
New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force | Out-Null
$listener = [Net.Sockets.TcpListener]::new($ip, $Port)
$listener.Start()
Write-Host "Forge lab canary listening on $BindAddress`:$Port. Stop with Ctrl+C."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 3000
            $client.SendTimeout = 3000
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            $record = [ordered]@{
                TimestampUtc = [DateTime]::UtcNow.ToString('o')
                RunId = $RunId
                RemoteEndpoint = [string]$client.Client.RemoteEndPoint
                RequestLine = $requestLine
            }
            Add-Content -LiteralPath $log -Value ($record | ConvertTo-Json -Compress) -Encoding UTF8
            $body = [Text.Encoding]::UTF8.GetBytes("forge-lab-canary:$RunId")
            $headers = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n")
            $stream.Write($headers, 0, $headers.Length)
            $stream.Write($body, 0, $body.Length)
            $stream.Flush()
        }
        finally {
            $client.Dispose()
        }
    }
}
finally {
    $listener.Stop()
}
