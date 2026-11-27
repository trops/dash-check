/**
 * github.js: ctx.github, read-only GitHub with GH_TOKEN (the bot's GitHub
 * provider in Dash; a token in CI). `fetch` can be passed in for tests.
 *
 *   pr(urlOrNumber)                  the PR, as GitHub gives it (plus `slug`)
 *   checksFor(sha, { repo })         { runs: [{ name, status, conclusion, url }], source }
 *   waitForChecks(sha, { timeoutSec, noChecksAfterSec, pollSec, repo })
 *                                    { runs, failed, pending, passed, noChecks, timedOut, waitedSec }
 *
 * Each call fails with GitHub's HTTP code and what to do about it.
 */
"use strict";

const { DashCheckError } = require("../util");

const PR_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)\/?(?:[#?].*)?$/;
const REPO_RE = /(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const OK_CONCLUSIONS = ["success", "skipped", "neutral"];

function fixFor(code, slug, hasToken) {
  if (code === 401) return hasToken ? "GH_TOKEN is wrong or expired: sign in to GitHub again" : "set GH_TOKEN (sign the bot's GitHub provider in)";
  if (code === 403) return `GH_TOKEN can't read ${slug}, or GitHub's rate limit was hit: give the token read access, or wait`;
  if (code === 404) return `${slug} or the PR isn't there, or GH_TOKEN can't see it: check the link and the token's repo access`;
  if (code >= 500) return "GitHub is having trouble: try again";
  return "check the link and GH_TOKEN";
}

function slugOf(text) {
  const m = String(text || "").trim().match(REPO_RE);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * @param {{ env: object, fetch?: Function, now?: () => number,
 *           sleep?: (ms: number) => Promise<void>, repo?: () => Promise<string|null> }} opts
 */
function makeGithub(opts) {
  const env = opts.env || {};
  const token = String(env.GH_TOKEN || env.GITHUB_TOKEN || "").trim();
  const doFetch = opts.fetch || (typeof fetch === "function" ? fetch : null);
  const now = opts.now || Date.now;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = String(env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  let lastSlug = null;

  async function api(p, what) {
    if (!doFetch) throw new DashCheckError("This Node has no fetch", { fix: "use Node 18 or later" });
    let res;
    try {
      res = await doFetch(`${base}/${p}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "dash-check",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch (e) {
      throw new DashCheckError(`Can't reach GitHub for ${what} (${e && e.message ? e.message : e})`, { fix: "check the network" });
    }
    let body = null;
    try {
      body = await res.json();
    } catch (_e) {
      body = null;
    }
    return { code: res.status, body };
  }

  async function need(p, what, slug) {
    const r = await api(p, what);
    if (r.code !== 200) {
      throw new DashCheckError(`GitHub said HTTP ${r.code} for ${what}`, { fix: fixFor(r.code, slug, !!token), code: r.code });
    }
    return r.body;
  }

  async function repoSlug(given) {
    const s = slugOf(given) || lastSlug || slugOf(env.GITHUB_REPOSITORY) || (opts.repo ? slugOf(await opts.repo()) : null);
    if (!s) {
      throw new DashCheckError("Don't know which GitHub repo", {
        fix: "give a full PR link (https://github.com/owner/repo/pull/1), or set GITHUB_REPOSITORY=owner/repo",
      });
    }
    return s;
  }

  const gh = {
    async pr(urlOrNumber, { repo } = {}) {
      let slug;
      let number;
      const m = String(urlOrNumber == null ? "" : urlOrNumber).trim().match(PR_URL_RE);
      if (m) {
        slug = `${m[1]}/${m[2]}`;
        number = Number(m[3]);
      } else if (/^#?\d+$/.test(String(urlOrNumber == null ? "" : urlOrNumber).trim())) {
        number = Number(String(urlOrNumber).replace("#", ""));
        slug = await repoSlug(repo);
      } else {
        throw new DashCheckError(
          urlOrNumber ? `${String(urlOrNumber).slice(0, 200)} isn't a GitHub PR link` : "No PR given",
          { fix: "use a link like https://github.com/owner/repo/pull/12, or a PR number" },
        );
      }
      lastSlug = slug;
      const body = await need(`repos/${slug}/pulls/${number}`, `PR #${number} on ${slug}`, slug);
      return { ...body, slug };
    },

    async checksFor(sha, { repo } = {}) {
      if (!sha) throw new DashCheckError("No commit given", { fix: "pass the PR's head sha (pr.head.sha)" });
      const slug = await repoSlug(repo);
      const c = await api(`repos/${slug}/commits/${sha}/check-runs?per_page=100`, `check runs on ${slug}`);
      if (c.code === 200) {
        const runs = ((c.body && c.body.check_runs) || []).map((r) => ({
          name: r.name, status: r.status, conclusion: r.conclusion || null, url: r.html_url || null,
        }));
        return { runs, source: "check-runs" };
      }
      const a = await api(`repos/${slug}/actions/runs?head_sha=${sha}&per_page=100`, `Actions runs on ${slug}`);
      if (a.code !== 200) {
        throw new DashCheckError(
          `GitHub said HTTP ${c.code} for check runs and HTTP ${a.code} for Actions runs on ${slug}`,
          { fix: `give GH_TOKEN read access to Checks or Actions on ${slug}`, code: a.code },
        );
      }
      const runs = ((a.body && a.body.workflow_runs) || []).map((r) => ({
        name: r.name, status: r.status, conclusion: r.conclusion || null, url: r.html_url || null,
      }));
      return { runs, source: "actions" };
    },

    async waitForChecks(sha, { timeoutSec = 1200, noChecksAfterSec = 180, pollSec = 15, repo } = {}) {
      const started = now();
      for (;;) {
        const { runs } = await gh.checksFor(sha, { repo });
        const waitedSec = Math.round((now() - started) / 1000);
        const pending = runs.filter((r) => r.status !== "completed");
        const failed = runs.filter((r) => r.status === "completed" && !OK_CONCLUSIONS.includes(r.conclusion));
        const passed = runs.filter((r) => r.status === "completed" && OK_CONCLUSIONS.includes(r.conclusion));
        const done = runs.length > 0 && pending.length === 0;
        const noChecks = runs.length === 0 && waitedSec >= noChecksAfterSec;
        const timedOut = !done && !noChecks && waitedSec >= timeoutSec;
        if (done || noChecks || timedOut) return { runs, failed, pending, passed, noChecks, timedOut, waitedSec };
        await sleep(Math.max(0, pollSec) * 1000);
      }
    },
  };
  return gh;
}

module.exports = { makeGithub, slugOf, PR_URL_RE };
