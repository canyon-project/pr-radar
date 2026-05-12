import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Space, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import BasicLayout from "@/layouts/BasicLayout.tsx";
import {
  createNote,
  deleteNote,
  listNotes,
  noteApiErrorMessage,
  updateNote,
  type Note,
} from "@/services/notes.ts";

const Projects = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [form] = Form.useForm<{ title: string; content: string }>();

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listNotes();
      setNotes(data);
    } catch {
      message.error("无法加载笔记列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: Note) => {
    setEditing(record);
    form.setFieldsValue({
      title: record.title,
      content: record.content,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      try {
        if (editing) {
          await updateNote(editing.id, values);
          message.success("已更新");
        } else {
          await createNote(values);
          message.success("已创建");
        }
        setModalOpen(false);
        void fetchNotes();
      } catch (e) {
        message.error(noteApiErrorMessage(e, editing ? "更新失败" : "创建失败"));
      }
    } catch {
      /* ignore validate error */
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteNote(id);
      message.success("已删除");
      void fetchNotes();
    } catch (e) {
      message.error(noteApiErrorMessage(e, "删除失败"));
    }
  };

  const columns: ColumnsType<Note> = [
    { title: "标题", dataIndex: "title", ellipsis: true },
    {
      title: "内容",
      dataIndex: "content",
      ellipsis: true,
      width: "38%",
      render: (text: string) => text.replace(/\s+/g, " ").slice(0, 80),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 200,
      render: (iso: string) => new Date(iso).toLocaleString(),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除这条笔记？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(record.id)}
          >
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <BasicLayout>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <h2 style={{ margin: 0, fontSize: 20 }}>笔记（Prisma Note）</h2>
          <Button type="primary" onClick={openCreate}>
            新建
          </Button>
          <Button onClick={() => void fetchNotes()} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>
      <Table<Note>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={notes}
        pagination={{ pageSize: 10, showSizeChanger: true }}
      />
      <Modal
        title={editing ? "编辑笔记" : "新建笔记"}
        open={modalOpen}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="标题" />
          </Form.Item>
          <Form.Item
            label="内容"
            name="content"
            rules={[{ required: true, message: "请输入内容" }]}
          >
            <Input.TextArea rows={6} placeholder="正文" />
          </Form.Item>
        </Form>
      </Modal>
    </BasicLayout>
  );
};

export default Projects;
