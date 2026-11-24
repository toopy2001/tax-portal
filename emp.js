/* ============================================================
   통합고용세액공제 계산 (조세특례제한법 제29조의8, 시행령 제26조의8)
   - 2026.1.1 이후 개시 과세연도: 1차·2차·3차 연도 공제액 구조 (법률 제21223호, 2025.12.23.)
   - 2024·2025년 증가분: 종전 규정 이어받기 (부칙 경과규정)
   - 입력 자료는 이 브라우저에만 저장 (서버 전송 없음)
   ============================================================ */
const EMPCALC = (() => {
  // 1인당 공제액 (만원) [1차, 2차, 3차]  — 법 제29조의8 ① 1·2호
  const RATE = {
    중소: { 수도권: { y: [700, 1600, 1700], o: [400, 900, 1000] }, 지방: { y: [1000, 1900, 2000], o: [700, 1200, 1300] } },
    중견: { 수도권: { y: [500, 900, 900], o: [300, 500, 500] }, 지방: { y: [500, 900, 900], o: [300, 500, 500] } },
    대기업: { 수도권: { y: [300, 500, 0], o: [0, 0, 0] }, 지방: { y: [300, 500, 0], o: [0, 0, 0] } },
  };
  // 최소고용증가인원수 차감 (법 ① 3호): [충족 시 1인당, 미달분 1인당] × [1차, 2·3차]
  const MIN = { 중견: { n: 5, met: [300, 500, 500], short: [500, 900, 900] }, 대기업: { n: 10, met: [0, 0, 0], short: [300, 500, 0] } };
  // 종전 규정 1인당 공제액 (만원, 2024·2025년 증가분) [청년등, 그 외]
  const OLD = { 중소: { 수도권: [1450, 850], 지방: [1550, 950] }, 중견: { 수도권: [800, 450], 지방: [800, 450] }, 대기업: { 수도권: [400, 0], 지방: [400, 0] } };
  const T2 = x => Math.floor(x * 100 + 1e-9) / 100;   // 1/100 미만 절사

  function parseDate(v) {
    const t = String(v || "").trim(); if (!t) return null;
    let m;
    if ((m = t.match(/^(\d{4})\D?(\d{1,2})\D?(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = t.match(/^(\d{2})(\d{2})(\d{2})(?:\s*-?\s*(\d))?/))) {   // 주민번호 앞자리(+뒷자리 첫 숫자)
      const g = m[4] ? +m[4] : null;
      const cen = g == null ? (+m[1] > (new Date().getFullYear() % 100) ? 1900 : 2000) : ([1, 2, 5, 6].includes(g) ? 1900 : [3, 4, 7, 8].includes(g) ? 2000 : 1800);
      return new Date(cen + +m[1], +m[2] - 1, +m[3]);
    }
    return null;
  }
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) - (b.getDate() < a.getDate() ? 1 : 0);
  const addYears = (d, n) => new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  const monthEnd = (y, m) => new Date(y, m + 1, 0);

  const EXCL = { 임원: "임원", 최대주주: "최대주주·대표자와 배우자·친족", 미확인: "원천징수·국민연금·건강보험 납부 확인 안 됨", 단시간제외: "단시간(월평균 60시간 미만)" };

  // 근로자 1명의 연도별 판정
  function judge(e, year, opt) {
    const notes = [];
    const hire = parseDate(e.hire), leave = parseDate(e.leave), birth = parseDate(e.birth);
    if (!hire) return { w: 0, months: 0, youthMonths: 0, notes: ["입사일 없음"], excl: "입사일 없음" };
    if (EXCL[e.kind]) return { w: 0, months: 0, youthMonths: 0, notes: [], excl: EXCL[e.kind] };
    if (e.work === "단시간제외") return { w: 0, months: 0, youthMonths: 0, notes: [], excl: EXCL.단시간제외 };
    // 근로기간 1년 미만 제외 (시행령 ② 1호)
    if (leave && monthsBetween(hire, leave) < 12) return { w: 0, months: 0, youthMonths: 0, notes: [], excl: "근로기간 1년 미만 (퇴사자)" };
    if (!leave && opt.under1y === "strict" && addYears(hire, 1) > monthEnd(year, 11)) return { w: 0, months: 0, youthMonths: 0, notes: [], excl: "과세연도 말 현재 근로기간 1년 미만" };
    const w = e.work === "단시간0.75" ? 0.75 : e.work === "단시간0.5" ? 0.5 : 1;
    let months = 0, youthMonths = 0, youthBy = "";
    const special = ["장애인", "경력단절", "북한이탈"].includes(e.kind);
    const ageAt = d => birth ? monthsBetween(birth, d) : null;
    const mil = Math.min(Math.max(+e.mil || 0, 0), 72);
    const hireAgeY = birth ? Math.floor(ageAt(hire) / 12) : null;
    const senior = birth && hireAgeY >= 60;
    const youthBan = e.kind === "기간제파견" || e.kind === "유해업소청소년";
    const keepY = opt.size === "대기업" ? 3 : 4;
    for (let m = 0; m < 12; m++) {
      const me = monthEnd(year, m);
      if (hire > me || (leave && leave < me)) continue;
      months++;
      let isY = special || senior;
      if (!isY && birth && !youthBan) {
        const adj = ageAt(me) - mil;
        if (adj >= 180 && adj < 420) { isY = true; if (!youthBy) youthBy = "청년(나이)"; }
        else if (ageAt(hire) - mil < 420 && ageAt(hire) - mil >= 180 && me <= addYears(hire, keepY)) { isY = true; youthBy = `청년(계약 당시 34세 이하 → ${keepY}년 간주)`; }
      }
      if (isY) youthMonths++;
    }
    if (special) youthBy = e.kind === "장애인" ? "장애인 등" : e.kind === "경력단절" ? "경력단절 근로자" : "북한이탈주민";
    else if (senior) youthBy = "60세 이상 (계약일 현재)";
    if (!birth) notes.push("생년월일 없음 → 청년 판정 못함");
    if (youthBan && birth) notes.push("기간제·파견·유해업소 청소년은 청년 제외");
    if (mil > 0) notes.push(`병역 ${mil}개월 차감`);
    if (w < 1) notes.push(`단시간 ${w}명`);
    return { w, months, youthMonths, youthBy, notes, excl: "" };
  }

  function counts(emps, year, opt) {
    let all = 0, youth = 0; const rows = [];
    for (const e of emps) {
      const j = judge(e, year, opt);
      all += j.w * j.months; youth += j.w * j.youthMonths;
      rows.push({ e, j });
    }
    const mo = opt.months || 12;
    return { all: T2(all / mo), youth: T2(youth / mo), rows };
  }

  // 새 규정 (2026.1.1 이후 개시 과세연도)
  function calcNew(c, opt) {
    // c: {Y:{all,youth}, Y1, Y2, Y3} — Y1·Y2·Y3 = 직전·전전·전전전 (null이면 비교 제외)
    const R = RATE[opt.size][opt.area], other = k => c[k] ? T2(c[k].all - c[k].youth) : null;
    const valid = k => c[k] && c[k].ok !== false;
    const out = { terms: [], total: 0, ok: false, why: "" };
    const prev = ["Y1", "Y2", "Y3"].filter(valid);
    out.ok = prev.some(k => c.Y.all > c[k].all);
    if (!out.ok) { out.why = "해당 과세연도 상시근로자 수가 비교 가능한 직전 3개 과세연도 어느 해보다도 늘지 않음"; return out; }
    if (opt.consum) { out.ok = false; out.why = "소비성서비스업은 적용 제외"; return out; }
    const seq = ["Y", "Y1", "Y2", "Y3"];
    const minOf = (keys, f) => Math.min(...keys.map(k => f(k)));
    const labels = ["1차 (직전 연도 대비)", "2차 (전전 연도 대비, 직전 연도 유지분)", "3차 (전전전 연도 대비, 2년 유지분)"];
    for (let i = 0; i < 3; i++) {
      const base = seq[i + 1];
      if (!valid(base)) { out.terms.push({ label: labels[i], skip: "비교 연도 없음 (2024.12.31 이전 개시 연도는 제외)" }); continue; }
      const keys = seq.slice(0, i + 1);
      const fAll = k => c[k].all, fY = k => c[k].youth, fO = k => other(k);
      const tAll = Math.max(0, T2(minOf(keys, fAll) - c[base].all));
      let tY = Math.max(0, T2(minOf(keys, fY) - c[base].youth));
      let tO = Math.max(0, T2(minOf(keys, fO) - other(base)));
      tY = Math.min(tY, tAll); tO = Math.min(tO, tAll);   // 전체 증가 인원 한도
      let amt = tY * R.y[i] + tO * R.o[i], ded = 0, dedNote = "";
      if (opt.size !== "중소" && MIN[opt.size]) {
        const M = MIN[opt.size];
        if (tO >= M.n) { ded = M.n * M.met[i]; dedNote = `최소고용증가인원 ${M.n}명 × ${M.met[i]}만원`; }
        else { ded = tO * M.met[i] + (M.n - tO) * M.short[i]; dedNote = `청년등외 ${tO}명 × ${M.met[i]} + 미달 ${T2(M.n - tO)}명 × ${M.short[i]}만원`; }
      }
      const net = Math.max(0, amt - ded);
      out.terms.push({ label: labels[i], tAll, tY, tO, rY: R.y[i], rO: R.o[i], amt, ded, dedNote, net });
      out.total += net;
    }
    out.total = Math.round(out.total * 10000);   // 원
    return out;
  }

  // 종전 규정 이어받기 (2024·2025년 증가분)
  function calcOld(o, opt, countsByYear, year) {
    // o: {first, ny, no, fAll, fYouth, taken:[연도…]}
    const [rY, rO] = OLD[opt.size][opt.area];
    const span = opt.size === "대기업" ? 1 : 2;
    const res = { first: o.first, rows: [], amount: 0, clawback: 0, note: "" };
    if (year <= o.first) { res.note = "최초 공제연도 이후에만 계산"; return res; }
    if (year > o.first + span) { res.note = `공제 기간 끝 (${o.first}~${o.first + span})`; return res; }
    let youthRate = rY, stop = false, claw = 0;
    for (let y = o.first + 1; y <= year; y++) {
      const c = countsByYear[y];
      if (!c) { res.rows.push({ y, msg: "상시근로자 수 없음" }); continue; }
      const dAll = Math.max(0, T2(o.fAll - c.all)), dY = Math.max(0, T2(o.fYouth - c.youth));
      const yearsTaken = y - o.first;   // 이미 공제받은 연수
      if (dAll > 0) {
        // 전체 감소: 공제 중단 + 추징 (종전 시행령 산식 기준 추정)
        let base = dY >= dAll ? (Math.min(dY, o.ny) - dAll) * (rY - rO) + dAll * rY : dY * rY + (dAll - dY) * rO;
        base = Math.max(0, Math.min(base, o.ny * rY + o.no * rO));
        if (y === year) claw = base * yearsTaken;
        res.rows.push({ y, msg: `전체 ${dAll}명 감소 → 그 해부터 공제 중단, 추징 대상` }); stop = true; break;
      }
      if (dY > 0 && youthRate === rY) {
        if (y === year) claw = Math.min(dY, o.ny) * (rY - rO) * yearsTaken;
        youthRate = rO; res.rows.push({ y, msg: `청년등 ${dY}명 감소(전체 유지) → 청년등 증가분에 그 외 금액 적용, 차액 추징` });
      } else res.rows.push({ y, msg: "유지" });
    }
    if (!stop) res.amount = Math.round((o.ny * youthRate + o.no * rO) * 10000);
    res.clawback = Math.round(claw * 10000);
    return res;
  }

  // 육아휴직 복귀자 추가공제 (법 ⑤: 2026.12.31까지 복귀, 1인당 중소 1,300 / 중견 900만원)
  function parental(emps, year, opt, allUp) {
    const per = opt.size === "중소" ? 1300 : opt.size === "중견" ? 900 : 0;
    const list = [];
    for (const e of emps) {
      const ret = parseDate(e.retDate); if (!ret || ret.getFullYear() !== year) continue;
      const hire = parseDate(e.hire), why = [];
      if (ret > new Date(2026, 11, 31)) why.push("2026.12.31 후 복귀");
      if ((+e.retMonths || 0) < 6) why.push("육아휴직 6개월 미만");
      if (hire && monthsBetween(hire, ret) - (+e.retMonths || 0) < 12) why.push("휴직 전 근무 1년 미만으로 보임");
      if (["최대주주", "임원"].includes(e.kind)) why.push("최대주주·친족 등");
      if (!per) why.push("중소·중견기업만");
      if (!allUp) why.push("전체 상시근로자 수가 직전 연도보다 줄면 미적용");
      list.push({ name: e.name, ok: !why.length, why });
    }
    const n = list.filter(x => x.ok).length;
    return { list, per, amount: n * per * 10000 };
  }

  return { RATE, OLD, MIN, parseDate, judge, counts, calcNew, calcOld, parental, T2 };
})();
if (typeof module !== "undefined") module.exports = EMPCALC;

/* ---------------- 화면 ---------------- */
const EMPUI = (() => {
  const C = EMPCALC;
  const won = x => Math.round(x).toLocaleString("ko-KR") + "원";
  const man = x => (+x).toLocaleString("ko-KR") + "만";
  const h = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KEY = "empState";
  const KINDS = [["일반", "일반"], ["장애인", "장애인·국가유공 상이자 등"], ["경력단절", "경력단절 근로자"], ["북한이탈", "북한이탈주민"], ["기간제파견", "기간제·파견 (청년 불가)"], ["유해업소청소년", "청소년유해업소 청소년"], ["임원", "임원 (제외)"], ["최대주주", "최대주주·대표자·배우자·친족 (제외)"], ["미확인", "원천징수·4대보험 미확인 (제외)"]];
  const WORKS = [["일반", "일반"], ["단시간0.5", "단시간 60h↑ (0.5명)"], ["단시간0.75", "단시간 0.75명 요건"], ["단시간제외", "단시간 60h 미만 (제외)"]];
  const blank = () => ({ name: "", birth: "", hire: "", leave: "", mil: "", work: "일반", kind: "일반", retDate: "", retMonths: "" });
  const defState = () => ({
    co: "", year: 2026, size: "중소", area: "수도권", consum: false, months: 12, under1y: "loose",
    emps: [blank(), blank(), blank()], ov: {}, olds: [],
    legal: { startup: false, prev297: false, merge: false, mat: false, tax: "", minTax: "", otherCredit: "", carry: "" },
  });
  let S = defState();
  const load = () => { try { const all = JSON.parse(localStorage.getItem(KEY) || "{}"); return all; } catch (e) { return {}; } };
  const save = () => { try { const all = load(); all[S.co || "(이름 없음)"] = S; all.__last = S.co || "(이름 없음)"; localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {} };
  let root;

  function mount(el) {
    root = el; const all = load(); if (all.__last && all[all.__last]) S = Object.assign(defState(), all[all.__last]);
    draw();
  }
  const opt = () => ({ size: S.size, area: S.area, consum: S.consum, months: +S.months || 12, under1y: S.under1y });

  function yearCounts() {
    const out = {};
    for (let y = S.year - 3; y <= S.year; y++) {
      const c = C.counts(S.emps.filter(e => e.hire), y, Object.assign(opt(), { months: y === S.year ? (+S.months || 12) : 12 }));
      const ov = S.ov[y] || {};
      out[y] = { auto: c, all: ov.all !== "" && ov.all != null ? +ov.all : c.all, youth: ov.youth !== "" && ov.youth != null ? +ov.youth : c.youth, ok: y >= 2025 };
    }
    return out;
  }

  function draw() {
    root.innerHTML = `
    <div class="emp">
      <div class="panel"><div class="panel-h">① 회사 정보 <span class="n">${h(S.year)} 과세연도</span>
        <span style="margin-left:auto;display:flex;gap:6px"><select id="eLoad" class="esel"><option value="">저장된 회사 불러오기</option>${Object.keys(load()).filter(k => k !== "__last").map(k => `<option>${h(k)}</option>`).join("")}</select><button class="ebtn" id="eNew">새로 시작</button></span></div>
        <div class="pbody egrid">
          <div class="field"><label>회사명 (저장용)</label><input type="text" data-s="co" value="${h(S.co)}" placeholder="예: ○○상사"></div>
          <div class="field"><label>과세연도</label><select data-s="year">${[2026, 2027, 2028].map(y => `<option ${S.year == y ? "selected" : ""}>${y}</option>`).join("")}</select><div class="hint">1월~12월 사업연도 기준</div></div>
          <div class="field"><label>기업 규모</label><select data-s="size">${["중소", "중견", "대기업"].map(v => `<option ${S.size == v ? "selected" : ""}>${v}</option>`).join("")}</select><div class="hint">대기업 = 중소·중견 아닌 기업</div></div>
          <div class="field"><label>소재지</label><select data-s="area"><option ${S.area == "수도권" ? "selected" : ""}>수도권</option><option value="지방" ${S.area == "지방" ? "selected" : ""}>수도권 밖</option></select></div>
          <div class="field"><label>해당 과세연도 개월 수</label><input type="text" data-s="months" value="${h(S.months)}" inputmode="numeric"><div class="hint">개업 등으로 1년이 안 되면</div></div>
          <div class="field"><label>근로기간 1년 미만 판정</label><select data-s="under1y"><option value="loose" ${S.under1y == "loose" ? "selected" : ""}>퇴사자만 실제 근로기간으로 (재직자 포함)</option><option value="strict" ${S.under1y == "strict" ? "selected" : ""}>재직자도 과세연도 말 1년 미만이면 제외</option></select><div class="hint">연말 입사 재직자 처리는 해석 확인 필요</div></div>
          <label class="echk"><input type="checkbox" data-s="consum" ${S.consum ? "checked" : ""}> 소비성서비스업 (호텔·여관업, 주점업 등 → 적용 제외)</label>
        </div></div>

      <div class="panel"><div class="panel-h">② 근로자 명단 <span class="n" id="eCnt"></span>
        <span style="margin-left:auto;display:flex;gap:6px"><button class="ebtn" id="ePasteT">엑셀에서 붙여넣기</button><button class="ebtn" id="eAdd">+ 줄 추가</button></span></div>
        <div id="ePaste" class="pbody hidden" style="border-bottom:1px solid var(--line)">
          <div class="hint" style="margin-bottom:6px">엑셀에서 아래 순서로 복사해 붙여넣기 (첫 줄 제목은 있어도 됨): <b>이름 · 생년월일(또는 주민번호 앞 7자리) · 입사일 · 퇴사일 · 병역개월 · 근무형태 · 구분 · 육아휴직 복귀일 · 휴직개월</b></div>
          <textarea id="ePasteBox" rows="5" style="width:100%;font:13px inherit;border:1px solid var(--line);border-radius:8px;padding:8px"></textarea>
          <div style="display:flex;gap:6px;margin-top:6px"><button class="ebtn pri" id="ePasteGo">명단에 넣기 (기존 명단 뒤에)</button><button class="ebtn" id="ePasteRep">명단 바꾸기</button></div>
        </div>
        <div class="cscroll"><table class="ctbl etbl"><thead><tr><th>이름</th><th>생년월일</th><th>입사일</th><th>퇴사일</th><th>병역(월)</th><th>근무형태</th><th>구분</th><th>육아휴직 복귀일</th><th>휴직(월)</th><th>${S.year} 판정</th><th></th></tr></thead><tbody id="eBody"></tbody></table></div>
        <div class="pbody hint" style="padding-top:8px">생년월일·날짜는 2025-03-02, 2025.3.2, 20250302, 900101-1 모두 가능. 퇴사자도 최근 4년 치는 넣어야 직전·전전 연도 인원이 맞게 나옴</div>
      </div>

      <div class="panel"><div class="panel-h">③ 연도별 상시근로자 수 <span class="n">자동 계산 · 칸에 숫자를 넣으면 그 값 사용</span></div>
        <div class="cscroll"><table class="ctbl"><thead><tr><th>과세연도</th><th>비교</th><th>전체 (자동)</th><th>청년등 (자동)</th><th>전체 (직접 입력)</th><th>청년등 (직접 입력)</th><th>청년등 외</th></tr></thead><tbody id="eYears"></tbody></table></div>
      </div>

      <div class="panel"><div class="panel-h">④ 2024·2025년 증가분 (종전 규정 이어받기) <span style="margin-left:auto"><button class="ebtn" id="eOldAdd">+ 추가</button></span></div>
        <div class="pbody"><div class="hint" style="margin-bottom:8px">2024년·2025년에 증가해 공제받은 인원은 종전 규정(1인당 금액·사후관리)을 계속 적용. 그 해 공제세액계산서의 숫자를 넣어 주세요.</div><div id="eOlds"></div></div></div>

      <div class="panel"><div class="panel-h">⑤ 법률상 검토 항목</div>
        <div class="pbody egrid">
          <label class="echk"><input type="checkbox" data-l="startup" ${S.legal.startup ? "checked" : ""}> 창업중소기업 등 세액감면(조특법 제6조) 적용 중</label>
          <label class="echk"><input type="checkbox" data-l="prev297" ${S.legal.prev297 ? "checked" : ""}> 같은 연도에 고용증대세액공제(제29조의7) 적용</label>
          <label class="echk"><input type="checkbox" data-l="merge" ${S.legal.merge ? "checked" : ""}> 합병·분할·사업양수·법인전환 등으로 근로자 승계</label>
          <label class="echk"><input type="checkbox" data-l="mat" ${S.legal.mat ? "checked" : ""}> 출산전후휴가 대체인력 있음</label>
          <div class="field"><label>산출세액 (원)</label><input type="text" data-l="tax" value="${h(S.legal.tax)}" inputmode="numeric" placeholder="최저한세·이월 계산용"></div>
          <div class="field"><label>최저한세액 (원)</label><input type="text" data-l="minTax" value="${h(S.legal.minTax)}" inputmode="numeric" placeholder="법인 중소: 과세표준 × 7%"></div>
          <div class="field"><label>다른 최저한세 대상 공제·감면 (원)</label><input type="text" data-l="otherCredit" value="${h(S.legal.otherCredit)}" inputmode="numeric"></div>
          <div class="field"><label>전년 이월된 통합고용세액공제 (원)</label><input type="text" data-l="carry" value="${h(S.legal.carry)}" inputmode="numeric"></div>
        </div></div>

      <div id="eResult"></div>
      <div class="cnote" style="margin-bottom:16px">근거: 조세특례제한법 제29조의8 (법률 제21223호 2025.12.23. 개정, 2026.1.1 이후 개시 과세연도부터 2028.12.31이 속하는 과세연도까지), 같은 법 시행령 제26조의8 (2025.12.31.·2026.2.27. 개정). 상시근로자 수는 근로자별 (월말 재직 개월 수 × 1, 0.5, 0.75) ÷ 과세연도 개월 수, 1/100 미만 절사. 판정이 애매한 항목은 결과의 '확인 필요'를 보세요.</div>
    </div>`;
    drawEmps(); drawOlds(); recalc(); bind();
  }

  function empRow(e, i, ys) {
    const sel = (k, list) => `<select data-e="${k}" data-i="${i}">${list.map(([v, t]) => `<option value="${v}" ${e[k] === v ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    const inp = (k, w, ph) => `<input data-e="${k}" data-i="${i}" value="${h(e[k])}" style="width:${w}px" placeholder="${ph || ""}">`;
    let jd = "";
    if (e.hire) {
      const r = ys[S.year].auto.rows.find(x => x.e === e);
      if (r) { const j = r.j; jd = j.excl ? `<span class="etag ex">제외 · ${h(j.excl)}</span>` : j.months ? `<span class="etag">${j.months}개월${j.w < 1 ? " ×" + j.w : ""}</span>${j.youthMonths ? `<span class="etag y">${h(j.youthBy || "청년등")} ${j.youthMonths}개월</span>` : ""}${j.notes.length ? `<div class="hint">${h(j.notes.join(" · "))}</div>` : ""}` : `<span class="etag">해당 연도 근무 없음</span>`; }
    }
    return `<tr><td>${inp("name", 70)}</td><td>${inp("birth", 92, "1995-03-02")}</td><td>${inp("hire", 92)}</td><td>${inp("leave", 92)}</td><td>${inp("mil", 44)}</td><td>${sel("work", WORKS)}</td><td>${sel("kind", KINDS)}</td><td>${inp("retDate", 92)}</td><td>${inp("retMonths", 40)}</td><td style="white-space:normal;min-width:160px">${jd}</td><td><button class="ebtn x" data-del="${i}">✕</button></td></tr>`;
  }
  function drawEmps() { const ys = yearCounts(); root.querySelector("#eBody").innerHTML = S.emps.map((e, i) => empRow(e, i, ys)).join(""); root.querySelector("#eCnt").textContent = S.emps.filter(e => e.hire).length + "명"; }
  function drawOlds() {
    root.querySelector("#eOlds").innerHTML = S.olds.length ? S.olds.map((o, i) => `<div class="eold">
      <div class="field"><label>최초 공제연도</label><select data-o="first" data-i="${i}">${[2024, 2025].map(y => `<option ${o.first == y ? "selected" : ""}>${y}</option>`).join("")}</select></div>
      <div class="field"><label>공제받은 청년등 증가 인원</label><input data-o="ny" data-i="${i}" value="${h(o.ny)}"></div>
      <div class="field"><label>공제받은 그 외 증가 인원</label><input data-o="no" data-i="${i}" value="${h(o.no)}"></div>
      <div class="field"><label>최초 연도 전체 상시근로자 수</label><input data-o="fAll" data-i="${i}" value="${h(o.fAll)}"></div>
      <div class="field"><label>최초 연도 청년등 상시근로자 수</label><input data-o="fYouth" data-i="${i}" value="${h(o.fYouth)}"></div>
      <button class="ebtn x" data-odel="${i}" style="align-self:center">✕</button></div>`).join("") : `<div class="hint">해당 없으면 비워 두세요.</div>`;
  }

  function recalc() {
    const ys = yearCounts(), Y = S.year;
    root.querySelector("#eYears").innerHTML = [Y - 3, Y - 2, Y - 1, Y].map(y => {
      const c = ys[y], ov = S.ov[y] || {};
      return `<tr><td><b>${y}</b> ${y === Y ? "해당" : y === Y - 1 ? "직전" : y === Y - 2 ? "전전" : "전전전"}</td><td>${y === Y ? "" : c.ok ? "비교" : '<span class="etag ex">제외 (2024.12.31 이전 개시)</span>'}</td>
        <td class="n">${c.auto.all.toFixed(2)}</td><td class="n">${c.auto.youth.toFixed(2)}</td>
        <td><input data-ov="all" data-y="${y}" value="${h(ov.all ?? "")}" style="width:80px"></td><td><input data-ov="youth" data-y="${y}" value="${h(ov.youth ?? "")}" style="width:80px"></td>
        <td class="n">${C.T2(c.all - c.youth).toFixed(2)}</td></tr>`;
    }).join("");
    const cc = { Y: ys[Y], Y1: ys[Y - 1], Y2: ys[Y - 2], Y3: ys[Y - 3] };
    const N = C.calcNew(cc, opt());
    const byYear = {}; Object.keys(ys).forEach(y => byYear[y] = ys[y]);
    const olds = S.olds.filter(o => o.ny !== "" || o.no !== "").map(o => C.calcOld({ first: +o.first, ny: +o.ny || 0, no: +o.no || 0, fAll: +o.fAll || 0, fYouth: +o.fYouth || 0 }, opt(), byYear, Y));
    const P = C.parental(S.emps, Y, opt(), ys[Y].all >= ys[Y - 1].all);
    const oldAmt = olds.reduce((a, o) => a + o.amount, 0), claw = olds.reduce((a, o) => a + o.clawback, 0);
    let total = N.total + oldAmt + P.amount;
    const warn = [], chk = [];
    if (S.legal.startup) { warn.push("창업중소기업 등 세액감면(제6조)과 통합고용세액공제는 동시에 적용 불가 (조특법 제127조④) → 유리한 쪽 선택"); }
    if (S.legal.prev297) warn.push("고용증대세액공제(제29조의7)와 통합고용세액공제 제1항은 동시 적용 불가 (제127조) → 하나만 선택");
    if (S.legal.merge) chk.push("합병·분할·사업양수 등: 직전 과세연도 상시근로자 수에 승계 인원 포함해 계산 (시행령 제26조의8⑥ → 제23조⑬ 준용). ③ 표에 직접 입력");
    if (S.legal.mat) chk.push("출산전후휴가 대체인력이 있으면 휴가 중인 근로자는 상시근로자 수에서 제외 (시행령 ⑦). 해당 기간만큼 ③ 표 수정");
    if (S.under1y === "loose") chk.push("과세연도 말 현재 입사 1년이 안 된 재직자를 포함해 계산함 — '실제 근로기간 1년 이상' 해석 확인 필요");
    if (S.emps.some(e => e.hire && !e.birth)) chk.push("생년월일 없는 근로자는 청년 판정을 하지 않음");
    if (S.emps.some(e => e.kind === "경력단절")) chk.push("경력단절 근로자: 같은 기업 1년 이상 근무 후 결혼·임신·출산·육아·자녀교육·가족돌봄 사유 퇴직, 퇴직 후 2년 이상 15년 미만 재취업, 최대주주 등 아님");
    if (S.size !== "중소") chk.push(`최소고용증가인원수: ${S.size === "중견" ? "중견 5명" : "대기업 10명"} 초과 증가분만 공제`);
    chk.push("공제세액은 최저한세 대상 (제132조), 공제받지 못한 금액은 10년간 이월공제 (제144조)");
    chk.push("신고 시 세액공제신청서·공제세액계산서·상시근로자 명세서 제출 (시행령 ⑪)");
    // 최저한세·이월
    const num = v => +String(v || "").replace(/[^\d.-]/g, "") || 0;
    const tax = num(S.legal.tax), minTax = num(S.legal.minTax), oth = num(S.legal.otherCredit), carry = num(S.legal.carry);
    let limitHtml = "";
    if (tax) {
      const lim = Math.max(0, tax - minTax - oth), want = total + carry, use = Math.min(lim, want);
      limitHtml = `<tr><td>최저한세 고려 공제 한도</td><td class="n">${won(lim)}</td></tr><tr><td>이번 연도 공제 (이월분 포함)</td><td class="n"><b>${won(use)}</b></td></tr><tr><td>다음 연도로 이월 (10년)</td><td class="n">${won(want - use)}</td></tr>`;
    }
    const tr = t => t.skip ? `<tr><td>${t.label}</td><td colspan="5" class="hint">${t.skip}</td></tr>` :
      `<tr><td>${t.label}</td><td class="n">${t.tAll}</td><td class="n">${t.tY} × ${man(t.rY)}</td><td class="n">${t.tO} × ${man(t.rO)}</td><td class="n">${t.ded ? "− " + man(t.ded) + `<div class="hint">${h(t.dedNote)}</div>` : ""}</td><td class="n"><b>${man(Math.round(t.net))}</b></td></tr>`;
    root.querySelector("#eResult").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span>${Y} 전체 / 청년등</span><b style="font-size:18px">${ys[Y].all.toFixed(2)} / ${ys[Y].youth.toFixed(2)}</b></div>
        <div class="kpi"><span>새 규정 공제액</span><b style="font-size:18px">${won(N.total)}</b></div>
        <div class="kpi"><span>종전분 + 육아휴직</span><b style="font-size:18px">${won(oldAmt + P.amount)}</b></div>
        <div class="kpi red"><span>합계 공제액</span><b style="font-size:18px">${won(total)}</b></div>
      </div>
      ${warn.map(w => `<div class="cerr" style="margin:0 0 10px">⚠️ ${h(w)}</div>`).join("")}
      <div class="panel"><div class="panel-h">새 규정 계산 (${S.size} · ${S.area === "지방" ? "수도권 밖" : "수도권"})</div>
        ${N.ok ? `<div class="cscroll"><table class="ctbl"><thead><tr><th>구분</th><th>전체 증가</th><th>청년등 × 1인당</th><th>청년등 외 × 1인당</th><th>최소인원 차감</th><th>공제액</th></tr></thead><tbody>${N.terms.map(tr).join("")}</tbody></table></div>
        <div class="pbody hint">각 단계 인원 = (해당 연도부터 그 비교 연도 직후까지 인원 중 가장 적은 수) − 비교 연도 인원, 음수는 0, 전체 증가 인원을 한도</div>` : `<div class="pbody"><b>공제 없음</b> — ${h(N.why)}</div>`}</div>
      ${olds.length ? `<div class="panel"><div class="panel-h">종전 규정 이어받기</div><div class="pbody">${olds.map(o => `<div style="margin-bottom:8px"><b>${o.first}년 증가분</b> → 이번 연도 공제 ${won(o.amount)}${o.clawback ? ` · <span style="color:var(--red)">추징 추정 ${won(o.clawback)}</span>` : ""}${o.note ? ` · ${h(o.note)}` : ""}<div class="hint">${o.rows.map(r => `${r.y}: ${h(r.msg)}`).join(" / ")}</div></div>`).join("")}${claw ? `<div class="hint">추징 금액은 종전 시행령 산식으로 계산한 추정치 (이자상당가산액 별도) — 실제 신고 전 확인 필요</div>` : ""}</div></div>` : ""}
      ${P.list.length ? `<div class="panel"><div class="panel-h">육아휴직 복귀자 추가공제 (1인당 ${man(P.per)}원)</div><div class="pbody">${P.list.map(x => `<div>${x.ok ? "✅" : "❌"} ${h(x.name || "(이름 없음)")} ${x.why.length ? `<span class="hint">${h(x.why.join(", "))}</span>` : ""}</div>`).join("")}<div class="hint" style="margin-top:6px">복귀 후 2년 안에 퇴사하면 공제세액 추징 (법 ⑦). 같은 자녀는 1회만</div></div></div>` : ""}
      ${limitHtml ? `<div class="panel"><div class="panel-h">최저한세·이월</div><div class="pbody"><table class="rtable">${limitHtml}</table></div></div>` : ""}
      <div class="panel"><div class="panel-h">확인 필요 <span class="n">${chk.length}</span></div><div class="pbody"><ul class="notes" style="margin:0">${chk.map(c => `<li>${h(c)}</li>`).join("")}</ul></div></div>
      <div style="display:flex;gap:8px;margin-bottom:16px"><button class="dlbtn" id="eCsv">⬇ 상시근로자 명세 (엑셀용 CSV)</button><button class="ebtn" id="eCopy">결과 복사</button></div>`;
    root.querySelector("#eCsv").onclick = () => csv(ys);
    root.querySelector("#eCopy").onclick = e => {
      const txt = `[통합고용세액공제 ${Y}] ${S.co} ${S.size}·${S.area === "지방" ? "수도권 밖" : "수도권"} / 상시근로자 ${ys[Y].all}(청년등 ${ys[Y].youth}) / 새 규정 ${won(N.total)} / 종전분 ${won(oldAmt)} / 육아휴직 ${won(P.amount)} / 합계 ${won(total)}`;
      navigator.clipboard.writeText(txt).then(() => e.target.textContent = "복사됨 ✓", () => e.target.textContent = "복사 실패");
    };
    save();
  }

  function csv(ys) {
    const Y = S.year, rows = [["이름", "생년월일", "입사일", "퇴사일", "병역(월)", "근무형태", "구분", ...[Y - 3, Y - 2, Y - 1, Y].flatMap(y => [`${y} 근무월`, `${y} 청년등월`, `${y} 판정`])]];
    for (const e of S.emps.filter(x => x.hire)) {
      const cells = [Y - 3, Y - 2, Y - 1, Y].flatMap(y => { const r = ys[y].auto.rows.find(x => x.e === e); const j = r ? r.j : {}; return [j.months ? j.months * j.w : 0, j.youthMonths ? j.youthMonths * j.w : 0, j.excl || j.youthBy || ""]; });
      rows.push([e.name, e.birth, e.hire, e.leave, e.mil, e.work, e.kind, ...cells]);
    }
    rows.push([]); rows.push(["과세연도", "전체 상시근로자 수", "청년등 상시근로자 수"]);
    [Y - 3, Y - 2, Y - 1, Y].forEach(y => rows.push([y, ys[y].all, ys[y].youth]));
    const text = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = `통합고용_상시근로자명세_${S.co || "회사"}_${Y}.csv`; a.click();
  }

  function parsePaste(text) {
    const lines = text.split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(r => r.some(Boolean));
    const kindOf = v => (KINDS.find(([k, t]) => v && (v === k || t.includes(v))) || ["일반"])[0];
    const workOf = v => /60.*미만|제외/.test(v) ? "단시간제외" : /0\.75/.test(v) ? "단시간0.75" : /단시간|0\.5/.test(v) ? "단시간0.5" : "일반";
    return lines.filter(r => !/이름|성명/.test(r[0]) && r[2]).map(r => ({ name: r[0] || "", birth: r[1] || "", hire: r[2] || "", leave: r[3] || "", mil: r[4] || "", work: workOf(r[5] || ""), kind: kindOf(r[6] || ""), retDate: r[7] || "", retMonths: r[8] || "" }));
  }

  function bind() {
    const q = s => root.querySelector(s);
    root.oninput = root.onchange = ev => {
      const t = ev.target;
      if (t.dataset.s) { S[t.dataset.s] = t.type === "checkbox" ? t.checked : (["year", "months"].includes(t.dataset.s) ? +t.value || t.value : t.value); if (ev.type === "change" && ["year", "size"].includes(t.dataset.s)) { draw(); return; } recalc(); if (ev.type === "change") drawEmps(); return; }
      if (t.dataset.l) { S.legal[t.dataset.l] = t.type === "checkbox" ? t.checked : t.value; recalc(); return; }
      if (t.dataset.e) { S.emps[+t.dataset.i][t.dataset.e] = t.value; recalc(); if (ev.type === "change") drawEmps(); return; }
      if (t.dataset.ov) { const y = t.dataset.y; S.ov[y] = S.ov[y] || {}; S.ov[y][t.dataset.ov] = t.value.trim(); if (ev.type === "change") recalc(); return; }
      if (t.dataset.o) { S.olds[+t.dataset.i][t.dataset.o] = t.value; if (ev.type === "change") recalc(); return; }
      if (t.id === "eLoad" && t.value) { const all = load(); S = Object.assign(defState(), all[t.value]); draw(); }
    };
    root.onclick = ev => {
      const t = ev.target;
      if (t.id === "eAdd") { S.emps.push(blank()); drawEmps(); }
      else if (t.dataset.del != null) { S.emps.splice(+t.dataset.del, 1); if (!S.emps.length) S.emps.push(blank()); drawEmps(); recalc(); }
      else if (t.id === "ePasteT") q("#ePaste").classList.toggle("hidden");
      else if (t.id === "ePasteGo" || t.id === "ePasteRep") {
        const add = parsePaste(q("#ePasteBox").value); if (!add.length) return;
        S.emps = t.id === "ePasteRep" ? add : [...S.emps.filter(e => e.hire || e.name), ...add];
        q("#ePasteBox").value = ""; q("#ePaste").classList.add("hidden"); drawEmps(); recalc();
      }
      else if (t.id === "eOldAdd") { S.olds.push({ first: 2025, ny: "", no: "", fAll: "", fYouth: "" }); drawOlds(); }
      else if (t.dataset.odel != null) { S.olds.splice(+t.dataset.odel, 1); drawOlds(); recalc(); }
      else if (t.id === "eNew") { if (confirmNew()) { S = defState(); draw(); } }
    };
  }
  function confirmNew() { return true; }   // 브라우저 확인창은 쓰지 않음 (저장본은 '불러오기'에 남아 있음)
  return { mount };
})();
