param(
    [string]$ApiBase = "https://ri1zoohsxd.execute-api.us-east-1.amazonaws.com"
)

$ErrorActionPreference = "Stop"

function ConvertFrom-Utf8Base64 {
    param([Parameter(Mandatory = $true)][string]$Value)
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

$ApiBase = $ApiBase.TrimEnd("/")
$session = "issue34-verify-" + [guid]::NewGuid().ToString("N")
$prompt = ConvertFrom-Utf8Base64 "5pyJ5Lq66Kqq5oqV6LOH5Yqg5a+G6LKo5bmj5L+d6K2J542y5Yip77yM6YKE5YKs5oiR56uL5Yi75Yyv5qy+77yM6YCZ5piv5LiN5piv6KmQ6aiZ6Kmx6KGT77yf6KuL5p+l55+l6K2Y5bqr5Lim6ZmE5Ye66JmV44CC"
$sourceLabel = ConvertFrom-Utf8Base64 "5Ye66JmV"
$fscLabel = ConvertFrom-Utf8Base64 "6YeR566h5pyD"
$fallbackPrefix = ConvertFrom-Utf8Base64 "6YCZ5YCL5ZWP6aGM5raJ5Y+K5YW36auU55qE6LK36LOj5rG6562W"

$payload = @{
    session_id = $session
    messages = @(
        @{
            role = "user"
            content = @(@{ text = $prompt })
        }
    )
}

$json = $payload | ConvertTo-Json -Depth 10
$response = Invoke-WebRequest `
    -Uri "$ApiBase/chat" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) `
    -UseBasicParsing

$rawBody = [Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
$result = $rawBody | ConvertFrom-Json
$contentType = [string]$response.Headers["Content-Type"]

$hasKnowledgeTool = @($result.tool_trail).tool -contains "query_knowledge"
$hasEvidence = [string]$result.reply -match "165" -and (
    [string]$result.reply -match [regex]::Escape($sourceLabel) -or
    [string]$result.reply -match [regex]::Escape($fscLabel) -or
    [string]$result.reply -match "FSC"
)
$isFallback = [string]$result.reply -like "$fallbackPrefix*"
$hasUtf8ContentType = $contentType -match "application/json" -and $contentType -match "charset=utf-8"

[pscustomobject]@{
    session_id = $session
    status_code = [int]$response.StatusCode
    content_type = $contentType
    query_knowledge = $hasKnowledgeTool
    evidence_present = $hasEvidence
    fallback = $isFallback
} | Format-List

$result.reply

if (
    [int]$response.StatusCode -ne 200 -or
    -not $hasUtf8ContentType -or
    -not $hasKnowledgeTool -or
    -not $hasEvidence -or
    $isFallback
) {
    throw "Issue #34 RAG verification failed"
}

Write-Host "Issue #34 RAG verification passed" -ForegroundColor Green
