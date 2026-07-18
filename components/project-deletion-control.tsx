"use client";

import { useEffect, useRef, useState } from "react";

import {
  deletionProgressLabel,
  parseProjectDeletionPayload,
  projectDeletionDesignStorageKey,
  projectDeletionStorageKey,
  shouldPollDeletion,
  type ProjectDeletionStatus,
} from "@/lib/design/project-deletion-client";

type ProjectDeletionControlProps = {
  projectId?: string | null;
  designId?: string | null;
  projectTitle?: string | null;
  canDelete: boolean;
  onCompleted: () => void;
};

function apiError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload
    && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : fallback;
}

function apiErrorCode(payload: unknown) {
  return payload && typeof payload === "object" && "code" in payload
    && typeof (payload as { code?: unknown }).code === "string"
    ? (payload as { code: string }).code
    : null;
}

/**
 * The server owns deletion. This control only requests a durable job, displays its
 * state, and remembers the job id so a refresh can resume polling safely.
 */
export function ProjectDeletionControl({
  projectId,
  designId,
  projectTitle,
  canDelete,
  onCompleted,
}: ProjectDeletionControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<ProjectDeletionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const completionReportedRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    let savedJobId: string | null = null;
    try {
      if (projectId) savedJobId = window.localStorage.getItem(projectDeletionStorageKey(projectId));
      if (!savedJobId && designId) savedJobId = window.localStorage.getItem(projectDeletionDesignStorageKey(designId));
    } catch {
      // Persistence is a convenience; the durable server job remains authoritative.
    }
    if (savedJobId) {
      setJobId(savedJobId);
      setIsOpen(true);
    }
  }, [designId, projectId]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const response = await fetch(`/api/projects/deletions/${jobId}`, { cache: "no-store" });
        const payload: unknown = await response.json().catch(() => null);
        if (!active) return;
        const nextJob = response.ok ? parseProjectDeletionPayload(payload) : null;
        if (!nextJob) {
          if (response.status === 404 && apiErrorCode(payload) === "DELETION_JOB_NOT_FOUND") {
            try {
              if (projectId) window.localStorage.removeItem(projectDeletionStorageKey(projectId));
              if (designId) window.localStorage.removeItem(projectDeletionDesignStorageKey(designId));
            } catch {
              // The stale in-memory job can still be dismissed when storage is unavailable.
            }
            setJobId(null);
            setJob(null);
            setIsOpen(false);
            setError(null);
            return;
          }
          setError(apiError(payload, "Deletion status could not be loaded."));
          timer = setTimeout(refresh, 4_000);
          return;
        }
        setJob(nextJob);
        setError(null);
        if (shouldPollDeletion(nextJob.state)) timer = setTimeout(refresh, 2_000);
      } catch (refreshError) {
        if (!active) return;
        setError(refreshError instanceof Error ? refreshError.message : "Deletion status could not be loaded.");
        timer = setTimeout(refresh, 4_000);
      }
    }

    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [designId, jobId, pollRevision, projectId]);

  useEffect(() => {
    if (job?.state !== "completed" || completionReportedRef.current) return;
    completionReportedRef.current = true;
    try {
      window.localStorage.removeItem(projectDeletionStorageKey(job.originalProjectId));
      if (projectId && projectId !== job.originalProjectId) window.localStorage.removeItem(projectDeletionStorageKey(projectId));
      if (designId) window.localStorage.removeItem(projectDeletionDesignStorageKey(designId));
    } catch {
      // Navigation after confirmed server completion must not depend on local storage.
    }
    onCompletedRef.current();
  }, [designId, job, projectId]);

  function persistJob(nextJob: ProjectDeletionStatus) {
    try {
      window.localStorage.setItem(projectDeletionStorageKey(nextJob.originalProjectId), nextJob.id);
      if (designId) window.localStorage.setItem(projectDeletionDesignStorageKey(designId), nextJob.id);
    } catch {
      // Polling continues for this mounted session when storage is unavailable.
    }
  }

  async function requestDeletion() {
    if (!canDelete || !projectId || !projectTitle || confirmationTitle !== projectTitle || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationTitle }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const nextJob = response.ok ? parseProjectDeletionPayload(payload) : null;
      if (!nextJob) {
        setError(apiError(payload, "The deletion request could not be accepted."));
        return;
      }
      persistJob(nextJob);
      setJob(nextJob);
      setJobId(nextJob.id);
      setPollRevision((revision) => revision + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The deletion request was interrupted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function retryDeletion() {
    if (!jobId || job?.state !== "failed" || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/deletions/${jobId}`, { method: "POST" });
      const payload: unknown = await response.json().catch(() => null);
      const nextJob = response.ok ? parseProjectDeletionPayload(payload) : null;
      if (!nextJob) {
        setError(apiError(payload, "The deletion retry could not be accepted."));
        return;
      }
      persistJob(nextJob);
      setJob(nextJob);
      setPollRevision((revision) => revision + 1);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "The deletion retry was interrupted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasDurableJob = Boolean(jobId || job);
  const mayStart = canDelete && Boolean(projectId && projectTitle);
  if (!mayStart && !hasDurableJob) return null;

  const waitingForStatus = hasDurableJob && !job;
  const deletionInProgress = Boolean(job && shouldPollDeletion(job.state));
  const exactTitleEntered = confirmationTitle === projectTitle;

  return <>
    <button
      className="inline-flex min-h-11 items-center border border-[#ff5b45]/75 px-3 py-2 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#ff806f] transition hover:bg-[#24100d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6ea]"
      onClick={() => setIsOpen(true)}
      type="button"
    >{hasDurableJob ? "Deletion status" : "Delete project"}</button>

    {isOpen ? <div aria-labelledby="delete-project-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#050504]/90 p-4" role="dialog">
      <section className="w-full max-w-xl border border-[#ff5b45]/65 bg-[#0d0c0a] p-5 shadow-[12px_14px_0_rgba(0,0,0,0.55)] sm:p-7">
        <p className="text-[0.63rem] font-extrabold uppercase tracking-[0.14em] text-[#ff806f]">Permanent action</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl tracking-[-0.03em]" id="delete-project-title">{hasDurableJob ? "Deleting project" : "Delete this project?"}</h2>

        {!hasDurableJob ? <>
          <p className="mt-4 text-sm leading-6 text-[#b5a697]">The project record, saved plans, generated drawings, reference captures, and renders will be permanently removed. This cannot be undone.</p>
          <label className="mt-5 block text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[#d8c9bc]" htmlFor="delete-project-confirmation">Type <span className="normal-case tracking-normal text-[#fff6ea]">{projectTitle}</span> exactly to confirm</label>
          <input
            autoComplete="off"
            autoFocus
            className="mt-2 min-h-11 w-full border border-[#8e5a31]/65 bg-[#080807] px-3 py-2 text-sm text-[#fff6ea] outline-none focus:border-[#ff806f]"
            id="delete-project-confirmation"
            onChange={(event) => setConfirmationTitle(event.target.value)}
            spellCheck={false}
            value={confirmationTitle}
          />
          {error ? <p className="mt-3 text-sm leading-6 text-[#ff806f]" role="alert">{error}</p> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button className="min-h-11 border border-[#8e5a31]/65 px-4 py-2 text-xs font-bold uppercase tracking-[0.1em]" disabled={isSubmitting} onClick={() => { setIsOpen(false); setConfirmationTitle(""); setError(null); }} type="button">Cancel</button>
            <button className="min-h-11 bg-[#ff5b45] px-4 py-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#090908] disabled:cursor-not-allowed disabled:bg-[#35211e] disabled:text-[#8e746f]" disabled={!exactTitleEntered || isSubmitting} onClick={() => void requestDeletion()} type="button">{isSubmitting ? "Requesting deletion…" : "Delete project and assets"}</button>
          </div>
        </> : <div aria-atomic="true" aria-live="polite" className="mt-5" role="status">
          <p className="text-sm font-semibold text-[#fff6ea]">{job ? deletionProgressLabel(job.state) : "Loading deletion status"}</p>
          <p className="mt-2 text-sm leading-6 text-[#b5a697]">{waitingForStatus ? "Reconnecting to the durable deletion job…" : deletionInProgress ? "Project actions remain locked while server cleanup completes." : job?.state === "failed" ? "Cleanup stopped safely. Retry the same deletion job after reviewing the server response." : "Server cleanup is complete. Returning to the dashboard…"}</p>
          {job ? <p className="mt-3 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-[#8f8275]">State {job.state.replaceAll("_", " ")} · attempt {job.attemptCount}</p> : null}
          {job?.state === "failed" && job.lastError ? <p className="mt-4 border border-[#ff5b45]/55 bg-[#180d09] p-3 text-sm leading-6 text-[#ff9b8e]" role="alert">{job.lastError}</p> : null}
          {error ? <p className="mt-4 text-sm leading-6 text-[#ff806f]" role="alert">{error}</p> : null}
          {job?.state === "failed" ? <button className="mt-5 min-h-11 bg-[#ff5b45] px-4 py-2 text-xs font-extrabold uppercase tracking-[0.1em] text-[#090908] disabled:opacity-50" disabled={isSubmitting} onClick={() => void retryDeletion()} type="button">{isSubmitting ? "Retrying…" : "Retry deletion"}</button> : null}
        </div>}
      </section>
    </div> : null}
  </>;
}
