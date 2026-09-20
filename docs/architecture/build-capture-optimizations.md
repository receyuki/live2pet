# Capture and archive optimizations

This records the independent checkpoints for #21. Output presets, active preview
60 FPS, authored timing and renderer/encoder versions remain unchanged. Native
performance observations are local macOS x64 measurements, not platform-wide
guarantees. Models, runtimes and generated archives are not redistributed.

## Store already-encoded media in generated archives

Clawd and Codex Package Builds now use ZIP method 0 (store) for `.webp` entries.
Manifests and documentation retain the normal zip.js compression. This changes
the outer archive, not the image encoding, transparency, frame count or delays.
Portable Projects use their existing independent compression policy.

This checkpoint was measured independently while capture batching was being
implemented. The #20 warm large-model profile spent about 51 seconds in archive
assembly, making redundant media compression a demonstrated bottleneck.

A local Node comparison fed the same extracted generated files to the public
archive APIs, first with the previous default compression, then with stored
media. Input extraction and output verification were outside the timed interval.
Both output archives were read back with CRC verification; every entry path and
decompressed byte matched the input. One final paired measurement per fixture:

| Generated package | Default compression | Stored media | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| Large Clawd, 3 animations | 50.938 s | 1.968 s | 51,098,674 | 51,089,631 |
| Small Clawd, 12 animations | 18.8 ms | 6.1 ms | 120,403 | 131,850 |
| Codex atlas | 4.1 ms | 1.4 ms | 33,974 | 53,512 |

The large archive avoided about 96% of assembly time. Tiny-package timings are
noise-sensitive and not a meaningful whole-build speed claim. Sparse images can
still compress further: the small fixtures grew by about 11 KiB and 19 KiB.
The Clawd 80 MiB compatibility warning continues to use the **final ZIP size**;
oversized valid packages remain saveable. No automatic installation is added.

Public Package Build tests verify compression methods, entry paths and exact
media readback, alongside existing real-codec target validators, cancellation,
archive-failure and oversized-output checks. Native whole-App measurements are
recorded separately from this isolated archive comparison.
