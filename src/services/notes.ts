import axios from "axios";

export type Note = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateNoteInput = {
  title: string;
  content: string;
};

export type UpdateNoteInput = {
  title?: string;
  content?: string;
};

const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export async function listNotes(): Promise<Note[]> {
  const { data } = await api.get<Note[]>("/notes");
  return data;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const { data } = await api.post<Note>("/notes", input);
  return data;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  const { data } = await api.patch<Note>(`/notes/${id}`, input);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await api.delete(`/notes/${id}`);
}

export function noteApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string } | undefined)?.message;
    if (typeof msg === "string" && msg.length > 0) {
      return msg;
    }
  }
  return fallback;
}
