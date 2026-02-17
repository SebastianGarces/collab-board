"use client";

import { LayoutDashboard, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { stripHtmlTags } from "@collab/shared/validation";

type Board = {
  id: string;
  name: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBoardName, setNewBoardName] = useState("Untitled Board");
  const [deleteTarget, setDeleteTarget] = useState<Board | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<Board | null>(null);
  const [editName, setEditName] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login");
    }
  }, [isPending, session, router]);

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/boards`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setBoards(data.boards ?? []);
      }
    } catch {
      // silently fail — user will see empty state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchBoards();
    }
  }, [session?.user, fetchBoards]);

  const openCreateDialog = () => {
    setNewBoardName("Untitled Board");
    setShowCreateDialog(true);
  };

  const createBoard = async () => {
    // Sanitize and truncate to max length (200 chars)
    const sanitized = stripHtmlTags(newBoardName).trim().slice(0, 200);
    if (!sanitized) return;
    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/boards`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sanitized }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowCreateDialog(false);
        router.push(`/canvas/${data.id}`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const openEditDialog = (board: Board) => {
    setEditTarget(board);
    setEditName(board.name);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    // Sanitize and truncate to max length (200 chars)
    const sanitized = stripHtmlTags(editName).trim().slice(0, 200);
    if (!sanitized) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_URL}/api/boards/${editTarget.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sanitized }),
      });
      if (res.ok) {
        setBoards((prev) =>
          prev.map((b) =>
            b.id === editTarget.id
              ? { ...b, name: sanitized, updatedAt: new Date().toISOString() }
              : b
          )
        );
      }
    } finally {
      setIsSavingEdit(false);
      setEditTarget(null);
    }
  };

  const deleteBoard = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/boards/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setBoards((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      }
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/login");
  };

  if (isPending || !session?.user) {
    return (
      <main className="min-h-screen grid place-content-center">
        Loading...
      </main>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="border-b border-[#2a2a2a] bg-[#1a1a1a]">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="h-5 w-5 text-[#60a5fa]" />
            <h1 className="text-lg font-semibold">CollabBoard</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#999]">
              {session.user.name ?? session.user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Your Boards</h2>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Board
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-[#666]">Loading boards...</div>
        ) : boards.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#666] mb-4">
              You don&apos;t have any boards yet.
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create your first board
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map((board) => (
              <Card
                key={board.id}
                className="cursor-pointer transition-colors hover:border-[#444] bg-[#1a1a1a] border-[#2a2a2a]"
                onClick={() => router.push(`/canvas/${board.id}`)}
              >
                <CardHeader>
                  <CardTitle className="truncate">{board.name}</CardTitle>
                  <CardDescription>
                    Updated {formatDate(board.updatedAt)}
                  </CardDescription>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#666] hover:text-[#ccc]"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(board);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#666] hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(board);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardAction>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create board dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) setShowCreateDialog(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Board</DialogTitle>
            <DialogDescription>
              Give your board a name to get started.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createBoard();
            }}
          >
            <Input
              placeholder="Board name"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              autoFocus
              disabled={isCreating}
              className="mb-4"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !newBoardName.trim()}
              >
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit board dialog */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Board</DialogTitle>
            <DialogDescription>
              Enter a new name for this board.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <Input
              placeholder="Board name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              disabled={isSavingEdit}
              className="mb-4"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
                disabled={isSavingEdit}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSavingEdit || !editName.trim()}
              >
                {isSavingEdit ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Board</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteBoard}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
