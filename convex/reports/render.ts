import type { ReportFacts } from "./facts";

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Journal notes, publisher names and rationale codes all arrive as data, so every
// dynamic value passes through here before it lands in the markup.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => escapes[char]);

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export function renderReport(facts: ReportFacts): string {
  const { subject, generatedAt, rollups, observations, insights, questions } = facts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Remi visit brief</title>
    <style>
      body { margin: 0; padding: 24px 16px; background: #f5f1ea; color: #2c2722; font-family: Georgia, "Times New Roman", serif; font-size: 16px; line-height: 1.6; }
      .sheet { max-width: 640px; margin: 0 auto; padding: 40px 36px; background: #fffdf9; border: 1px solid #e6ded2; border-radius: 10px; }
      h1 { margin: 0 0 10px; font-size: 26px; font-weight: 600; }
      h2 { margin: 36px 0 12px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #7d7266; }
      p { margin: 0 0 8px; }
      .meta { color: #6f6559; font-size: 15px; }
      .banner { margin-top: 24px; padding: 16px 18px; background: #f3ece1; border: 1px solid #e2d7c6; border-radius: 8px; font-size: 14px; color: #574c40; }
      table { width: 100%; border-collapse: collapse; }
      th { padding: 0 10px 8px 0; border-bottom: 1px solid #e6ded2; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #8b8073; text-align: left; }
      td { padding: 12px 10px 12px 0; border-bottom: 1px solid #efe9df; font-size: 15px; vertical-align: top; }
      .empty { color: #8b8073; }
      .when { color: #6f6559; white-space: nowrap; }
      .detail { display: block; margin-top: 4px; font-size: 13px; color: #7d7266; }
      .tiny { display: block; margin-top: 6px; font-size: 12px; color: #8b8073; }
      ol { margin: 0; padding-left: 22px; }
      li { margin-bottom: 14px; }
      a { color: #5c5147; }
      .footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #e6ded2; font-size: 13px; color: #7d7266; }
    </style>
  </head>
  <body>
    <main class="sheet">
      <h1>Remi visit brief</h1>
      <p class="meta">${escapeHtml(subject.name)}, age band ${escapeHtml(subject.ageBand)}, relationship ${escapeHtml(subject.relationship)}</p>
      <p class="meta">Generated ${day(generatedAt)}</p>
      <p class="banner">Remi is informational. It is not a diagnosis, a screening result, a risk prediction, a medical device, or an emergency service.</p>

      <h2>Check-in results</h2>
      <table>
        <thead>
          <tr><th>Domain</th><th>Value</th><th>Model confidence</th><th>Rationale</th></tr>
        </thead>
        <tbody>
${
  rollups.length === 0
    ? `          <tr><td class="empty" colspan="4">No finished check-in yet.</td></tr>`
    : rollups
        .map(
          ({ domain, value, confidence, rationaleCode }) =>
            `          <tr><td>${escapeHtml(domain)}</td><td>${
              value === null ? "inconclusive" : value.toFixed(2)
            }</td><td>${confidence.toFixed(2)}</td><td>${escapeHtml(rationaleCode)}</td></tr>`,
        )
        .join("\n")
}
        </tbody>
      </table>

      <h2>What you have noticed</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Observation</th></tr>
        </thead>
        <tbody>
${
  observations.length === 0
    ? `          <tr><td class="empty" colspan="2">No reviewed observations yet.</td></tr>`
    : observations
        .map(({ observedAt, factualSummary, context, tags }) => {
          const detail = [
            context.length === 0 ? "" : `Context: ${context.map(escapeHtml).join(", ")}`,
            tags.length === 0 ? "" : `Tags: ${tags.map(escapeHtml).join(", ")}`,
          ]
            .filter((line) => line !== "")
            .join(" / ");
          return `          <tr><td class="when">${
            observedAt === null ? "date not recorded" : day(observedAt)
          }</td><td>${escapeHtml(factualSummary)}${
            detail === "" ? "" : `<span class="detail">${detail}</span>`
          }</td></tr>`;
        })
        .join("\n")
}
        </tbody>
      </table>

      <h2>Sources</h2>
      <table>
        <tbody>
${
  insights.length === 0
    ? `          <tr><td class="empty">No matched sources yet.</td></tr>`
    : insights
        .map(
          ({ publisher, url, excerpt, fetchedAt, matchType, rationaleCode }) =>
            `          <tr><td><strong>${escapeHtml(publisher)}</strong><span class="detail"><a href="${escapeHtml(
              url,
            )}">${escapeHtml(url)}</a></span><span class="detail">${escapeHtml(
              excerpt,
            )}</span><span class="tiny">Fetched ${day(fetchedAt)}, match type ${escapeHtml(
              matchType,
            )}, rationale ${escapeHtml(rationaleCode)}</span></td></tr>`,
        )
        .join("\n")
}
        </tbody>
      </table>

      <h2>Questions for your clinician</h2>
      <ol>
${
  questions.length === 0
    ? `        <li class="empty">No clinician questions drafted yet.</li>`
    : questions
        .map(
          ({ prompt, basis }) =>
            `        <li>${escapeHtml(prompt)}<span class="tiny">Basis: ${escapeHtml(basis)}</span></li>`,
        )
        .join("\n")
}
      </ol>

      <p class="footer">This brief is informational. It is not a diagnosis, a screening result, a risk prediction, a medical device, or an emergency service. Remi does not diagnose or rule out any condition. Review it with a clinician, and contact emergency services for urgent symptoms.</p>
    </main>
  </body>
</html>
`;
}
