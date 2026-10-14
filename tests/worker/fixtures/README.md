# One Call 4.0 fixture provenance

These seven JSON files are sanitized Paris daily-timeline captures from the approved
Batch 4A validation on 14 October 2026 (48.8566, 2.3522, metric, English). They were
copied from the sanitized evidence retained under `/tmp` during that exercise.
No new live calls were made for Batch 4B. Key-bearing next/prev links and credentials
were removed before persistence; pagination metadata is simulated separately in
tests using explicit synthetic markers. Weather fields remain as captured.

- `paris-near`: attempt 3, October 14–23, 2026.
- `paris-30`: attempt 4, November 13–22, 2026.
- `paris-180`: attempt 5, April 12–21, 2027.
- `paris-500`: attempt 6, February 26–March 6, 2028, including leap day.
- `paris-next`: attempt 7, April 22–May 1, 2027.
- `paris-dst`: attempt 8, October 24–November 2, 2026.
- `paris-midnight`: attempt 9, October 13–22, 2026 (local-midnight probe).

Other-zone records in tests are deliberately synthetic. Neither those examples nor
captured scalar rain establish daily precipitation totals or forecast accuracy.
