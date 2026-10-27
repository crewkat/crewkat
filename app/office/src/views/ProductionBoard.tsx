import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import type { BoardJob, ProductionStage } from "../types";
import { PRODUCTION_STAGES, PRODUCTION_STAGE_LABELS } from "../types";
import { cleanError, formatMoney, parseMoney } from "../utils";

/**
 * Wave 1: the Production Board — every job as a card in its production
 * stage. Dragging a card (or using the stage menu on the job) moves it
 * through Scheduled → In Progress → Punch List → Complete → Paid in
 * Full via setJobProductionStage. Cards carry the budget chip
 * (contract sum + margin) and a stuck highlight when nothing has
 * touched the job in 7+ days. Money arrives blanked from the server
 * for members whose seeMoney switch is off — hidden, never faked.
 */
export function ProductionBoard({ onOpenJob }: { onOpenJob: (jobId: number) => void }) {
  const queryClient = useQueryClient();
  const [dragOverStage, setDragOverStage] = useState<ProductionStage | null>(null);
  const [boardError, setBoardError] = useState("");

  const boardQuery = useQuery({ queryKey: ["production-board"], queryFn: () => api.getProductionBoard({}) });
  const jobs = useMemo(() => boardQuery.data?.jobs ?? [], [boardQuery.data]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["production-board"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["follow-up-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["office-dashboard"] });
  };

  const stageMutation = useMutation({
    mutationFn: (args: { jobId: number; stage: ProductionStage }) => api.setJobProductionStage(args),
    onError: (err) => { setBoardError(cleanError(err)); invalidate(); },
    onSuccess: (result) => {
      if (result.reviewFollowUp === "emailed") setBoardError("");
      invalidate();
    },
  });

  const moveJob = (job: BoardJob, stage: ProductionStage) => {
    if (job.productionStage === stage) return;
    setBoardError("");
    // Optimistic move; the refetch reverts it if the server rejects.
    queryClient.setQueryData<{ stages: { key: ProductionStage; label: string }[]; jobs: BoardJob[] }>(["production-board"], (old) =>
      old ? { ...old, jobs: old.jobs.map((j) => (j.id === job.id ? { ...j, productionStage: stage } : j)) } : old,
    );
    stageMutation.mutate({ jobId: job.id, stage });
  };

  const byStage = useMemo(() => {
    const map = new Map<ProductionStage, BoardJob[]>(PRODUCTION_STAGES.map((s) => [s, []]));
    for (const job of jobs) map.get(job.productionStage)?.push(job);
    return map;
  }, [jobs]);

  if (boardQuery.isLoading) return <div className="view-loading">Loading production board…</div>;
  if (boardQuery.isError) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◍</div>
        <p>Couldn't load the production board.</p>
        <button type="button" className="btn btn-primary" onClick={() => void boardQuery.refetch()}>Try again</button>
      </div>
    );
  }

  return (
    <>
      {boardError ? <p className="inline-error">{boardError}</p> : null}
      <div className="kanban">
        {PRODUCTION_STAGES.map((stage) => {
          const column = byStage.get(stage) ?? [];
          const total = column.reduce((sum, j) => sum + parseMoney(j.contractSum), 0);
          const moneyVisible = column.some((j) => j.contractSum !== "");
          return (
            <section
              key={stage}
              className={`kanban-col prod-${stage}${dragOverStage === stage ? " drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage); }}
              onDragLeave={() => setDragOverStage((cur) => (cur === stage ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverStage(null);
                const id = Number(e.dataTransfer.getData("text/job-id"));
                const job = jobs.find((j) => j.id === id);
                if (job) moveJob(job, stage);
              }}
            >
              <header className="kanban-head">
                <span className="kanban-title">{PRODUCTION_STAGE_LABELS[stage]}</span>
                <span className="kanban-count">{column.length}</span>
                {moneyVisible ? <span className="kanban-total">{formatMoney(total)}</span> : null}
              </header>
              <div className="kanban-body">
                {column.length === 0 ? (
                  <div className="kanban-empty">No jobs here.<br />Drag a card over to move it.</div>
                ) : column.map((job) => (
                  <article
                    key={job.id}
                    className={`lead-card job-card${job.stuck ? " is-stuck" : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/job-id", String(job.id)); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => onOpenJob(job.id)}
                    title={job.stuck ? "No activity in 7+ days" : undefined}
                  >
                    <div className="lead-card-top">
                      <span className="lead-name">{job.clientName}</span>
                      {job.stuck ? <span className="stuck-flag" title={`No activity for ${job.idleDays} days`}>Stuck {job.idleDays}d</span> : null}
                    </div>
                    {job.jobType ? <span className="lead-service">{job.jobType}</span> : null}
                    {job.jobAddress ? <span className="lead-source">{job.jobAddress}</span> : null}
                    <div className="lead-card-meta">
                      {job.contractSum !== "" ? (
                        <span className="lead-value">{formatMoney(job.contractSum)}</span>
                      ) : <span className="lead-value muted">—</span>}
                      <BudgetChip job={job} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** The budget-vs-actual chip: margin % when costs exist, an honest
 *  "no costs yet" otherwise, red under 15%. Renders nothing when the
 *  member's seeMoney switch hides money (contract arrives blank). */
export function BudgetChip({ job }: { job: BoardJob }) {
  if (job.contractSum === "") return null;
  if (!job.hasCosts || job.marginPercent === null) {
    return <span className="budget-chip is-none" title="No costs logged yet — margin appears once receipts, time, or expenses land">No costs yet</span>;
  }
  return (
    <span className={`budget-chip${job.lowMargin ? " is-low" : ""}`} title={job.lowMargin ? "Margin under 15% — check this job's costs" : "Margin so far"}>
      {job.marginPercent.toFixed(1)}% margin
    </span>
  );
}
