# Watch-16 revaluation — disposition (2026-08-18)

Two passes were run over the 16 watch-only tickers. Each proposed band went
through an adversarial review that opened every cited file and checked the
value verbatim.

**Round 1 was rejected in full (17/17).** Rationales cited figures that do not
exist in the data files — an invented "SEC-computed P/E", an unverified value
described as verified, an undisclosed multiple cut. Part of the cause was a
moving target: `data/fundamentals.json` was regenerated twice by CI while that
pass ran. Nothing from round 1 was merged.

Round 2 ran against pinned data and required a `citations[]` array of
`{path, value}` pairs behind every number in the rationale.

## Accepted and applied (7)

| ticker | band | moved from | upside vs verified close | confidence | citations checked |
|---|---|---|---|---|---|
| NVDA | 165 / 199 / 250 | _kept_ | -11.56% | low | 34 |
| AMD | 270 / 380 / 510 | _kept_ | -24.9% | low | 35 |
| KLAC | 145 / 175 / 220 | 1450/1750/2200 | -14.95% | low | 40 |
| INTC | 42 / 65 / 110 | _kept_ | -37.19% | low | 38 |
| MSFT | 380 / 445 / 520 | _kept_ | -7.36% | low | 41 |
| ORCL | 185 / 210 / 265 | _kept_ | 43.2% | low | 37 |
| TSMU | 67 / 83 / 103 | _kept_ | 16.06% | medium | 41 |

Six of the seven deliberately KEPT their 2026-06-05 bands, having found no
fundamental reason to move one — which is the intended outcome, not a null
result. The exception is KLAC, restated for its 10-for-1 split (below).

## Rejected — left at June vintage (9)

These bands were NOT written to `data/valuations.json`. Their June entries
stand and the dashboard continues to mark them STALE. In every case the
reviewer confirmed the citations and the arithmetic, then rejected on a prose
defect — a number in the rationale with nothing behind it, or a claim the files
contradict. Under this repo's bar an unverifiable rationale invalidates the
band it supports, so none were merged.

### TSM

All 34 citations[] entries verify verbatim (quotes 430.97/verified true/3 sources/2026-08-17/extended 420.62 pre-market; valuations 390/487/600, updated 2026-06-05, nextReview 2026-07-15, all four rationale leg strings exact; fundamentals sourceCount 1, trailingVerified false, 31.346, 13.7488, 21.9424, NTM, forwardVerified false, note exact; failures[] {"symbol":"TSM","source":"sec-xbrl","reason":"sec:http_404"} present; targets verified true 430/533.36/675/19; note + collectionMethod exact substrings; news-latest items[0] verified true collectedAt 2026-06-04T22:22:31Z; README lines 131-132; tickers-universe TSM.held false). Band unchanged, bandMovedFrom null, 390<487<600, and 487/430.97-1 = +13.00% matches upsideMidPct 13. Two claims in the prose are nevertheless refutable, and each is fa

### ARM

All 27 citations[] entries verify verbatim, including the awkward ones: quotes.ARM 271.43 / verified true / sourceCount 3 / 2026-08-17 / extended 260.9216 pre-market; valuations 195/280/380, updated 2026-06-05, and all four leg strings exact; fundamentals trailingVerified FALSE, trailingPE 320.6876, eps 0.8464, perSource['sec-xbrl'] trailingPE 276.97 / epsUsed 0.98 / quartersUsed exactly [2026-06-30, 2026-03-31, 2025-12-31, 2025-09-30] / anchorPrice 271.43 / anchorVerified true, forwardEps 2.387, forwardVerified false, NTM sourceCount 1; tolerance.trailingEps 0.01; targets.ARM.verified false with both the note fragment and the stockanalysis.com excludedReason exact; news-latest items[0] verified true collectedAt 2026-04-22T13:30:00Z and items[1] verified false; tickers-universe ARM.held fa

### AMAT

All 38 citations verified verbatim against the files (price 535.31 / verified true / sourceCount 3 / regularSessionDate 2026-08-17; extended 510.2459 / -4.6822 / verified true; eps 11.5943, trailingPE 46.1701, trailingVerified false, sec-xbrl epsUsed 10.63 / trailingPE 50.36 / quartersUsed ending 2026-04-26; forwardPE 30.3688 on forwardEps 17.627, forwardVerified false; mean 634.41 / low 429 / 39 analysts / verified true / basis string; stockanalysis low 358, tipranks low 500, marketbeat carries no low; both README quotes match lines 191-192; all 5 news items verified:false). All derived arithmetic reproduces: (465+440)/2=452.5, 452/11.5943=38.98, 452/10.63=42.52, (452-535.31)/535.31=-15.56, (358+500)/2=429. Band kept, bandMovedFrom null, 370<452<560, no drift toward the 535.31 close. FAIL

### LRCX

All 30 citations verified verbatim (price 343.84 / verified true / sourceCount 3 / 2026-08-17; extended.price 326.96 with extended.perSource.cnbc 326 and extended.verified false, correctly outside the 0.002 equity tolerance; trailingVerified true, eps 5.7641, trailingPE 59.652, sec-xbrl epsUsed 5.76 / trailingPE 59.69 / anchorVerified true; forwardPE 36.5166 on forwardEps 9.416, forwardVerified false; mean 373.58 / low 290 / high 500 / 35 analysts / verified true / basis string including 'low/high from stockanalysis.com only'; both valuations excerpts present verbatim; all 5 news items verified:false). Derived arithmetic reproduces: 0.4x607+0.6x320 = 434.80, 370/5.7641 = 64.19, (370-343.84)/343.84 = 7.61. The non-reproducibility finding is real and I confirmed no weighting of 607 and 320 y

### META

Every listed citation matches the files verbatim — quotes.META 568.97/true/3/2026-08-17, extended 562.61 pre-market, valuations.META 570/681/800 and currentPrice 590.495, the quoted leg and capex strings (substring-tested, exact), fundamentals.META trailingVerified false / eps 28.8783 / trailingPE 19.7023 / sec-xbrl epsUsed 26.54 / trailingPE 21.44 / quartersUsed / forwardEps 30.422 / forwardVerified false, analyst-targets.META verified false with basis and note exact, VIX perSource, held false — and I recounted news-feed: META 444 items, 0 verified:true, matches, as do the 5 all-false news-latest items. Arithmetic reproduces: -3.65% vs the June stamp, +19.69% = upsideMidPct, (620+720+702)/3=680.67, 570 vs 620 = -8.06%, 28.8783 vs 26.54 = 8.81%. The fvLow-has-no-derivation finding is corre

### TSLA

All listed citations match: quotes.TSLA 339.3/true/3/2026-08-17, extended 334.33 pre-market, valuations.TSLA 180/325/520 and currentPrice 392.68, the SOTP / EV-Sales / bull-case strings (substring-tested, exact), fundamentals.TSLA trailingVerified false / eps 0.9992 / trailingPE 339.5717 / sec-xbrl 1.08 and 314.17 / quartersUsed / forwardEps 1.888 / forwardPE 179.714 / forwardVerified false, analyst-targets.TSLA verified true / 125 / 389.58 / 600 / 47 with the basis line, the byte-identical-vendor note and the $429.52 stale-price FLAG all exact. Recounted news-feed: TSLA 453, 0 verified — matches. 180+40+80+25=325, 145/325=44.6%, 389.58/325-1=+19.87%, (180-339.3)/339.3=-46.95%, 325/339.3-1=-4.21% (= upsideMidPct, consistent) all reproduce. FATAL 1 — a number attributed to a source that doe

### PLTR

All 28 citations verify verbatim (price 172.55 / verified true / regularSessionDate 2026-08-17 / extended 171.62 / asOfDate 2026-08-18 / session pre-market; June band 65/90/140, currentPrice 135.53, updated 2026-06-05, and all three stated legs $27-$34, mid $82, $88, 'Three-method average $90 fvMid'; targets low 80 / mean 193.1 / high 255 / n=32 / verified true; fundamentals trailingPE 147.0388, trailingVerified true, sec-xbrl 147.48, quartersUsed[0] 2026-06-30, forwardPE 100.3781, NTM, forwardVerified false; reports/raw/2026-07-29-quotes.json nasdaq PLTR 121.3; data/README.md line 199 carries the quoted sell-side sentence exactly; all five news-latest PLTR items verified:false). Arithmetic checks: 90/172.55-1 = -47.8412% -> -47.84 correct; the 'lands near $67' derivation reproduces (30.5+

### SNOW

Every citation verifies verbatim (price 330.11, verified true, sourceCount 3; June band 165/220/300, updated 2026-06-05, and all quoted rationale fragments match exactly — 'at 14-16x -> $54.6B-$62.4B EV; 340M diluted shares + $3.5B net cash -> $171-$194/sh, mid $182', 'blend $100', '$119-$147, mid $135', 'Three-method average $139', 'fvMid $220 = 16x ARR + Rule-of-40 sustained base'; targets.SNOW.verified false with basis string exact; fundamentals trailingPE null, eps -3.5145, sec-xbrl epsUsed -3.52, quartersUsed[0] 2026-04-30, forwardPE 155.7123, forwardVerified false; news-latest SNOW items all verified:false with items[3].collectedAt 2026-08-12T11:42:28Z). Arithmetic: 220/330.11-1 = -33.3555% -> -33.36 correct; 165<220<300; band held with bandMovedFrom null; no drift toward the $330.11

### CRWD

The split restatement is REAL and I independently confirmed it rather than taking it on trust: reports/raw/2026-07-01-quotes.json perSourceRaw.nasdaq.CRWD.price = 769.9025 and reports/raw/2026-07-02-quotes.json = 194.82, with 769.9025/4 = 192.475625 (the entry's '192.4756' is a correct derivation, labelled as such); the control pairs verify exactly (TSM 449.01 -> 435.68, PLTR 124.84 -> 129.57, both continuous), so it is not a feed-format break. Every other citation is verbatim too: price 213.9 / verified true / sourceCount 3; June 400/490/640, currentPrice 668.13, updated 2026-06-05, with the PEG-leg and weighting strings ('$675 mid on NTM basis'; 'Weighted average (EV/ARR 40%, FCF 20%, PEG 40%) = $170+$39+$270 = $479, rounded to fvMid $490') matching character for character; both news-fee

## Split restatements (applied separately, mechanical)

Two bands were quoting pre-split share counts. Both are division only — no
thesis was re-derived, and both stay flagged stale.

- **KLAC 10-for-1, effective 2026-06-12.** `reports/raw/2026-06-11-quotes.json`
  nasdaq 2429.99 to `reports/raw/2026-06-12-quotes.json` 254.19. The 2026-06-05
  band 1450/1750/2200 had been reading 10x high against a 205.76 close ever
  since. Restated to 145/175/220 (accepted through review).
- **CRWD 4-for-1, effective 2026-07-02.** `reports/raw/2026-07-01-quotes.json`
  nasdaq 769.9025 to `reports/raw/2026-07-02-quotes.json` 194.82
  (769.9025 / 4 = 192.48), while TSM (449.01 to 435.68) and PLTR (124.84 to
  129.57) moved continuously across the same pair, ruling out a feed-format
  break. Band 400/490/640 restated to 100/122.5/160. CRWD's round-2 rationale
  was rejected on prose grounds and is NOT adopted — only the arithmetic was
  applied, and `data/risk-scores.json` CRWD was re-stated against the verified
  close in the same pass.

## Follow-up

Re-run the 9 rejected tickers with the citation discipline that got the other
seven through. The failure mode is well characterised now: the bands and the
arithmetic hold up: it is the prose that reaches for uncited numbers.
