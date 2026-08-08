# Recovery-state audit (DS-1002)

Every major failure needs: What happened / Likely cause / One primary
recovery action / Advanced details.

| Failure | Likely cause | Primary recovery | Advanced details |
|---|---|---|---|
| No input signal | Wrong endpoint or app routed elsewhere | Pick the endpoint on Sources/Live | Health state `silent`; isolation test |
| Missing cable | VB-CABLE not installed | Install from vb-audio.com, refresh | Detection card lists candidates |
| Missing monitor device | Monitoring on, device gone | Re-pick headphones or turn monitoring off | Validation blocks save |
| Model unavailable | Not installed/corrupt | Install/reinstall on Models page | Checksum verified installs |
| Model checksum failure | Partial/corrupt download | Reinstall; staging is cleaned | Never leaves half-installed model |
| CUDA runtime failure | Pack missing/broken DLLs | Download pack or fall back to CPU | Device readout shows cpu/int8 |
| Overload | Too many sources/models | Lower quality profile or fewer sources | Budget warnings; provisionals shed first |
| Translation failure | Endpoint/provider error | Switch provider or retry | Placeholder caption with reason |
| Sidecar restart | Transport failure (10054) | Automatic; warning shown | Crash trace in warning; stderr tail |
| Endpoint disconnect | Device removed/exclusive use | Re-select or release device | Health `disconnected`; recovery UI |
