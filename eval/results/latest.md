# Eval 2026-11-20T08-46-58-530Z
provider=gemini judge=gemini mode=quick fixture=my-test-store-voezprx7-report.json
PO approval rate: no decisions logged yet

| strategy | sampling | T | top-p | valid | grounded | distinct-2 | ROUGE-L | judge (1-5) | tokens | latency ms |
|---|---|---|---|---|---|---|---|---|---|---|
| plain | greedy-ish | 0.1 | 1 | yes | 1.00 | 0.93 | – | 4.33 | 3625 | 5823 |
| plain | balanced | 0.7 | 0.9 | yes | 1.00 | 0.94 | – | 4.33 | 3703 | 6858 |
| plain | creative | 1.1 | 0.95 | yes | 1.00 | 0.95 | – | 4.33 | 3531 | 4727 |
| cot | greedy-ish | 0.1 | 1 | yes | 1.00 | 0.91 | – | 4.44 | 3631 | 5253 |
| cot | balanced | 0.7 | 0.9 | yes | 1.00 | 0.92 | – | 4.33 | 3755 | 6441 |
| cot | creative | 1.1 | 0.95 | yes | 1.00 | 0.91 | – | 4.44 | 3705 | 4309 |
| tot | greedy-ish | 0.1 | 1 | yes | 1.00 | 0.90 | – | 4.56 | 3625 | 5454 |
| tot | balanced | 0.7 | 0.9 | yes | 1.00 | 0.95 | – | 4.44 | 3587 | 5809 |
| tot | creative | 1.1 | 0.95 | yes | 1.00 | 0.90 | – | 4.22 | 3711 | 4448 |
