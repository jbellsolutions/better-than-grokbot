"use client";
import { useEffect, useState } from "react";

type UpdateInfo = { checkedAt: number | null; errors: string[]; sources: { id: string; label: string; version: string; url: string; notes: string[]; changedAt?: number }[] };

export function UpdateStatus() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    const read = () => void fetch("/api/updates", { cache: "no-store" }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(j => { if (!stopped) { setInfo(j); setFailed(false); } }).catch(() => { if (!stopped) setFailed(true); });
    read();
    const timer = setInterval(read, 60000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return (
    <div className="flex flex-col gap-2 px-[22px] pt-4 pb-4">
      <span className="text-[13px] font-semibold">Updates</span>
      <div className="flex flex-col gap-3 rounded-[14px] p-3.5 text-[12.5px] leading-[18px] shadow-[0_0_0_1px_#E6E6E3]">
        <span className="text-[#6B6B6B]">Checks hourly while this Mac is running. Updates are reviewed before installation.</span>
        {info?.sources.map(source => (
          <div key={source.id} className="flex flex-col gap-0.5">
            <a href={source.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{source.label} · {source.version} ↗</a>
            {source.notes.map((note, i) => <span key={i} className="text-[#6B6B6B]">{note}</span>)}
            {source.changedAt && <span className="text-[#6B6B6B]">New update detected {new Date(source.changedAt).toLocaleString()}</span>}
          </div>
        ))}
        {info?.checkedAt && <span className="text-[#9A9A98]">Last checked {new Date(info.checkedAt).toLocaleString()}</span>}
        {(failed ? ["Could not load update status."] : info?.errors || []).map(error => <span key={error} role="status" className="text-[#9A5B26]">{error}</span>)}
      </div>
    </div>
  );
}
