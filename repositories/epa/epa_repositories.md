# EPA Repository Intelligence

## SEMS
Purpose:
Primary Superfund site system.

Known Issues:
- ColdFusion backend
- inconsistent search rendering
- direct queries more reliable than UI search
- partial JSON exposure

Known Endpoints:
- https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm
- https://semspub.epa.gov/src/collection/

Preferred Retrieval Strategy:
1. Direct site profile URL
2. Document repository lookup
3. EPA publication references
4. Fallback web-assisted discovery

---

## Five-Year Reviews

Purpose:
Longitudinal remediation monitoring.

Notes:
- Often PDF-based
- inconsistent naming conventions
- may require direct search by site + "five year review"

---