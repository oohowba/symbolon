# SPEC：把「agent.id 未驗證」寫白 + 預留升級掛勾（三方共識 C 案）

目標：不新增功能、不改 wire format、不動 schema 的驗證邏輯。只做「文字釘清楚 + 驗證器/CLI 明示未背書 + 預留 v0.2 升級語意」。全程 backward compatible，任何既有 v0.1 收據不受影響。

## 改動清單（共 5 個檔，逐一照做，不要多改別的）

### 1. `spec.md`

**(1a) Boundary 那句（第 9–10 行）** — 在既有清單加入 agent 身分。原句：
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer identity, not legal enforceability, not dispute outcomes.

改成（加 `not agent identity`）：
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer or agent identity, not legal enforceability, not dispute outcomes.

**(1b) §3 Field notes** — 在 `events[].actor` 那條的**上方**，新增一條 `agent.id` 說明（新增 bullet，不要改動其他 bullet）：
> - **`agent.id`** — a **self-asserted, descriptive** label (e.g. `urn:agent:claude`). It is NOT authenticated: anyone can write any value, and the issuer's signature does not vouch for it. Verifiers MUST treat `agent.id` as descriptive only and MUST NOT use it as authentication, for settlement, ranking, reputation, or profit-sharing. Verifying *which* agent acted is the job of a future, optional attestation extension (see §5).

**(1c) §5 Deferred** — 把 `agent identity attestation (DID/VC envelopes)` 這一項，從單純列名擴寫為帶「升級觸發條件」的描述。將 §5 段落中的 `agent identity attestation (DID/VC envelopes)` 換成：
> agent identity attestation (a reserved, backward-compatible `agent_attestation` extension — most likely an agent **co-signature** where `agent.id` binds to the fingerprint of the agent's own key — to be added **only when** an ecosystem actually starts using `agent.id` for settlement, ranking, reputation, or profit-sharing; DID/VC envelopes remain a later option)

### 2. `README.md`

**Boundary 區塊（"The boundary" 底下的引用句）** 同 1a 一致化。原句：
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer identity, not legal enforceability, not dispute outcomes.

改成：
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer or agent identity, not legal enforceability, not dispute outcomes.

### 3. `verifier/index.html`

**(3a)** 在 `verify()` 函式最後、`renderVerdict(...)` 呼叫（約第 203 行）**之前**，新增一個永遠顯示的資訊列，明示 agent 未背書。用既有的 `renderStep(name, verdict, note)`，verdict 傳既有的 `SKIP` 類（灰色，`--skip` 色，非 pass 非 fail，語意=「不做背書」）：
```js
  renderStep('agent identity', 'SKIP', `${receipt.agent?.id ?? '(none)'} — self-asserted, not attested; do not use as authentication`);
```
（若 `renderStep` 的 verdict class 目前僅接受 PASS/FAIL，請沿用它已存在的 skip/灰色樣式名稱；不要新增 CSS，用現成的 `--skip` 對應 class。先確認 class 名再填。）

**(3b)** 頁尾 `<p class="foot">`（約第 67–68 行）把 `identity` 明確化為 `customer or agent identity`。原文：
> not payment finality, identity, enforceability, or disputes.

改成：
> not payment finality, customer or agent identity, enforceability, or disputes.

### 4. `tools/verify.mjs`

在最後印出 `RESULT:` 那行（約第 146 行）**之前**，多印一行資訊（不影響 exit code、不算 fail）：
```js
console.log(`NOTE agent identity — ${receipt.agent?.id ?? '(none)'}: self-asserted, not attested; not authentication.`);
```

### 5. 同步部署副本

- `dist/spec.md`：改完後讓它與 `spec.md` **逐字一致**（目前兩者相同，直接同步）。
- `dist/index.html`：套用與 (3a)(3b) **相同的內容改動**，但**保留 dist 版原有的路徑差異**（例如 Spec 連結、examples 路徑不同），只加/改上述兩處文字與那一列 renderStep，其餘不動。

## 驗收條件（你自己先跑過再回報）
1. `node tools/verify.mjs examples/happy-path.json examples/well-known.json`（或該 CLI 既有用法）→ 仍 `RESULT: VALID`，且多出一行 `NOTE agent identity …`；exit code 不變。
2. `node tools/verify.mjs examples/tampered.json …` → 仍 `INVALID (fail-closed)`。
3. `diff -q spec.md dist/spec.md` → 一致。
4. 確認 schema.json **完全沒動**、examples/*.json **完全沒動**、wire format 未變。
5. 回報：每個檔改了哪幾行、驗收 1–2 的實際輸出貼出來。
