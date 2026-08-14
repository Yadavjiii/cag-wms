import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { api } from "../api/client";
import { Card, ErrorText } from "../components/ui";
import { SearchResults } from "../types";
import { fmtDateTime, statusLabel } from "../lib/format";

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [term, setTerm] = useState(q);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    setTerm(q);
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    api<SearchResults>(`/search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch((e) => setErr(e instanceof Error ? e.message : "Search failed"));
  }, [q]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    nav(`/search?q=${encodeURIComponent(term)}`);
  }

  const empty =
    results && !results.tasks.length && !results.people.length && !results.projects.length && !results.meetings.length;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="font-serif text-2xl text-indigo-950">Search</h1>
      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative grow">
          <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search work items, people, projects, meetings..."
            className="w-full border border-slate-200 rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
        </div>
      </form>

      <ErrorText>{err}</ErrorText>

      {!results && <div className="text-sm text-slate-400">Type at least 2 characters to search.</div>}
      {empty && <div className="text-sm text-slate-400">No results for &ldquo;{q}&rdquo;.</div>}

      {results && results.tasks.length > 0 && (
        <Card title="Work items">
          <div className="space-y-1">
            {results.tasks.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 text-sm">
                <span className="font-medium text-slate-700">{t.title}</span>
                <span className="ml-auto text-xs text-slate-400">{statusLabel[t.status]}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {results && results.people.length > 0 && (
        <Card title="People">
          <div className="space-y-1">
            {results.people.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="font-medium text-slate-700">{p.fullName}</span>
                {p.designation && <span className="text-xs text-slate-400">{p.designation.name}</span>}
                <span className="ml-auto text-xs text-slate-400">{p.email}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {results && results.projects.length > 0 && (
        <Card title="Projects">
          <div className="flex flex-wrap gap-2">
            {results.projects.map((t) => (
              <span key={t.id} className="text-sm px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">{t.name}</span>
            ))}
          </div>
        </Card>
      )}

      {results && results.meetings.length > 0 && (
        <Card title="Meetings">
          <div className="space-y-1">
            {results.meetings.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <span className="font-medium text-slate-700">{m.title}</span>
                <span className="ml-auto text-xs text-slate-400">{fmtDateTime(m.startsAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
