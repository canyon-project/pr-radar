import { PlusOutlined } from "@ant-design/icons";
import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import BasicLayout from "@/layouts/BasicLayout.tsx";
import {
  createPrRadarWatchTask,
  deletePrRadarWatchTask,
  getGithubTokenStatus,
  getPrRadarJob,
  listPrRadarMergedPrs,
  listPrRadarWatchTasks,
  pollPrRadarWatchTaskNow,
  prRadarApiErrorMessage,
  putGithubToken,
  updatePrRadarWatchTask,
  type PrRadarJobDto,
  type PrRadarMergedPr,
  type PrRadarWatchTask,
} from "@/services/prRadar.ts";
import {
  BOT_WORKFLOW_REPO_PATH,
  DEFAULT_BOT_TEST_YAML,
} from "@/shared/schemas/prRadarWatchBot.ts";

function YamlEditorField(props: { value?: string; onChange?: (v: string) => void }) {
  const { value, onChange } = props;
  return (
    <div className="overflow-hidden rounded-md border border-gray-300">
      <Editor
        height={280}
        theme="vs"
        defaultLanguage="yaml"
        value={value ?? ""}
        options={{
          minimap: { enabled: false },
          tabSize: 2,
          scrollBeyondLastLine: false,
        }}
        onChange={(v) => onChange?.(v ?? "")}
      />
    </div>
  );
}

function TextBlobEditorField(props: { value?: string; onChange?: (v: string) => void }) {
  const { value, onChange } = props;
  return (
    <div className="overflow-hidden rounded-md border border-gray-300">
      <Editor
        height={160}
        theme="vs"
        defaultLanguage="plaintext"
        value={value ?? ""}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        }}
        onChange={(v) => onChange?.(v ?? "")}
      />
    </div>
  );
}

const PrRadarPage = () => {
  const [tokenConfigured, setTokenConfigured] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<PrRadarWatchTask[]>([]);
  const [merged, setMerged] = useState<PrRadarMergedPr[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingMerged, setLoadingMerged] = useState(false);
  const [filterTaskId, setFilterTaskId] = useState<string | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PrRadarWatchTask | null>(null);
  const [form] = Form.useForm<{
    repositoryUrl: string;
    branch: string;
    intervalMinutes: number;
    enabled: boolean;
    botWorkflowYaml: string;
    botOverlayFiles: { path: string; content: string }[];
  }>();

  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenForm] = Form.useForm<{ token: string }>();

  const [pollDrawerOpen, setPollDrawerOpen] = useState(false);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
  const [trackedJob, setTrackedJob] = useState<PrRadarJobDto | null>(null);

  const fetchTokenStatus = useCallback(async () => {
    try {
      const st = await getGithubTokenStatus();
      setTokenConfigured(st.configured);
    } catch {
      setTokenConfigured(null);
      message.error("无法读取 GitHub Token 状态");
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const data = await listPrRadarWatchTasks();
      setTasks(data);
    } catch {
      message.error("无法加载监听任务");
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  const fetchMerged = useCallback(async () => {
    setLoadingMerged(true);
    try {
      const data = await listPrRadarMergedPrs(filterTaskId);
      setMerged(data);
    } catch {
      message.error("无法加载合并 PR 列表");
    } finally {
      setLoadingMerged(false);
    }
  }, [filterTaskId]);

  useEffect(() => {
    void fetchTokenStatus();
  }, [fetchTokenStatus]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    void fetchMerged();
  }, [fetchMerged]);

  useEffect(() => {
    const jobId = trackedJobId;
    if (!jobId || !pollDrawerOpen) return undefined;
    const stableJobId = jobId;

    let terminalFetched = false;

    async function pollOnce() {
      try {
        const j = await getPrRadarJob(stableJobId);
        setTrackedJob(j);
        const done = j.status === "SUCCEEDED" || j.status === "FAILED";
        if (done && !terminalFetched) {
          terminalFetched = true;
          await Promise.all([fetchTasks(), fetchMerged()]);
        }
      } catch {
        /* skip */
      }
    }

    void pollOnce();
    const id = window.setInterval(() => void pollOnce(), 1_600);
    return () => window.clearInterval(id);
  }, [trackedJobId, pollDrawerOpen, fetchTasks, fetchMerged]);

  const taskOptions = useMemo(
    () =>
      tasks.map((t) => ({
        label: `${t.owner}/${t.repo} · ${t.branch}`,
        value: t.id,
      })),
    [tasks],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      repositoryUrl: "",
      branch: "main",
      intervalMinutes: 15,
      enabled: true,
      botWorkflowYaml: DEFAULT_BOT_TEST_YAML,
      botOverlayFiles: [],
    });
    setModalOpen(true);
  };

  const openEdit = (record: PrRadarWatchTask) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      repositoryUrl: record.repositoryUrl,
      branch: record.branch,
      intervalMinutes: record.intervalMinutes,
      enabled: record.enabled,
      botWorkflowYaml:
        typeof record.botWorkflowYaml === "string" && record.botWorkflowYaml.trim()
          ? record.botWorkflowYaml
          : DEFAULT_BOT_TEST_YAML,
      botOverlayFiles: Array.isArray(record.botOverlayFiles) ? [...record.botOverlayFiles] : [],
    });
    setModalOpen(true);
  };

  const submitTask = async () => {
    try {
      const values = await form.validateFields();
      try {
        if (editing) {
          await updatePrRadarWatchTask(editing.id, {
            repositoryUrl: values.repositoryUrl,
            branch: values.branch,
            intervalMinutes: values.intervalMinutes,
            enabled: values.enabled,
            botWorkflowYaml: values.botWorkflowYaml,
            botOverlayFiles: values.botOverlayFiles ?? [],
          });
          message.success("已更新监听任务");
        } else {
          await createPrRadarWatchTask({
            repositoryUrl: values.repositoryUrl,
            branch: values.branch,
            intervalMinutes: values.intervalMinutes,
            enabled: values.enabled,
            botWorkflowYaml: values.botWorkflowYaml,
            botOverlayFiles: values.botOverlayFiles ?? [],
          });
          message.success("已创建监听任务");
        }
        setModalOpen(false);
        await fetchTasks();
      } catch (e) {
        message.error(prRadarApiErrorMessage(e, editing ? "更新失败" : "创建失败"));
      }
    } catch {
      /* validate error */
    }
  };

  const removeTask = async (id: string) => {
    try {
      await deletePrRadarWatchTask(id);
      message.success("已删除");
      await fetchTasks();
      if (filterTaskId === id) setFilterTaskId(undefined);
    } catch (e) {
      message.error(prRadarApiErrorMessage(e, "删除失败"));
    }
  };

  const pollNow = async (id: string) => {
    try {
      const res = await pollPrRadarWatchTaskNow(id);
      setTrackedJob(null);
      setTrackedJobId(res.jobId);
      setPollDrawerOpen(true);
      message.info(
        res.reused ? "队列中仍有未完成作业，以下为同一异步任务日志" : "已排队异步抓取，正在轮询日志",
      );
    } catch (e) {
      message.error(prRadarApiErrorMessage(e, "排队失败"));
    }
  };

  const saveToken = async () => {
    try {
      const { token } = await tokenForm.validateFields();
      try {
        await putGithubToken(token);
        message.success("已保存 Token（写入 Infra 表）");
        setTokenModalOpen(false);
        tokenForm.resetFields();
        await fetchTokenStatus();
      } catch (e) {
        message.error(prRadarApiErrorMessage(e, "保存失败"));
      }
    } catch {
      /* validate */
    }
  };

  const taskColumns: ColumnsType<PrRadarWatchTask> = [
    {
      title: "仓库",
      key: "repo",
      ellipsis: true,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <a href={r.repositoryUrl} target="_blank" rel="noreferrer">
            {r.owner}/{r.repo}
          </a>
          <span style={{ color: "rgba(0,0,0,0.45)", fontSize: 12 }}>
            base: <Tag bordered={false}>{r.branch}</Tag>
          </span>
        </Space>
      ),
    },
    { title: "频率（分钟）", dataIndex: "intervalMinutes", width: 120 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 90,
      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: "上次拉取",
      dataIndex: "lastPolledAt",
      width: 180,
      render: (iso: string | null) =>
        iso ? new Date(iso).toLocaleString() : <span style={{ color: "#999" }}>尚未拉取</span>,
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" onClick={() => void pollNow(record.id)}>
            立即拉取（异步）
          </Button>
          <Popconfirm title="删除此监听任务及其已入库 PR 记录？" onConfirm={() => void removeTask(record.id)}>
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const mergedColumns: ColumnsType<PrRadarMergedPr> = [
    {
      title: "仓库 / 分支",
      key: "task",
      width: 220,
      ellipsis: true,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.taskSummary.repositoryUrl}</span>
          <span style={{ color: "#999", fontSize: 12 }}>
            base: <Tag bordered={false}>{r.taskSummary.branch}</Tag>
          </span>
        </Space>
      ),
    },
    { title: "PR #", dataIndex: "githubPrNumber", width: 80 },
    {
      title: "标题",
      dataIndex: "title",
      ellipsis: true,
      render: (t: string, r) => (
        <a href={r.htmlUrl} target="_blank" rel="noreferrer">
          {t}
        </a>
      ),
    },
    {
      title: "合并时间",
      dataIndex: "mergedAt",
      width: 180,
      render: (iso: string) => new Date(iso).toLocaleString(),
    },
    {
      title: "Bot 分支",
      key: "botBranch",
      width: 200,
      ellipsis: true,
      render: (_, r) =>
        r.botBranchHtmlUrl ? (
          <a href={r.botBranchHtmlUrl} target="_blank" rel="noreferrer">
            {r.botBranchName ?? "打开分支"}
          </a>
        ) : (
          <span style={{ color: "#999" }}>—</span>
        ),
    },
    {
      title: "Bot 状态",
      key: "botStatus",
      width: 160,
      render: (_, r) => {
        if (r.botPushedAt) {
          return <Tag color="green">已推送</Tag>;
        }
        if (r.botLastError) {
          return (
            <Tooltip title={r.botLastError}>
              <Tag color="red">失败（悬停查看）</Tag>
            </Tooltip>
          );
        }
        return <Tag>待处理</Tag>;
      },
    },
    {
      title: "合并者",
      dataIndex: "mergedByLogin",
      width: 120,
      render: (v: string | null) => v ?? <span style={{ color: "#999" }}>-</span>,
    },
  ];

  return (
    <BasicLayout>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 style={{ margin: 0, fontSize: 20 }}>GitHub PR 雷达</h2>
          <Space wrap>
            <Button onClick={() => void fetchMerged()} loading={loadingMerged}>
              刷新合并 PR 列表
            </Button>
            <Button type="primary" onClick={() => void fetchTasks()} loading={loadingTasks}>
              刷新任务列表
            </Button>
          </Space>
        </div>

        <Alert
          type={tokenConfigured ? "success" : "warning"}
          showIcon
          message={
            tokenConfigured
              ? "GitHub PAT 已通过 Infra 表配置完成"
              : "尚未保存 GitHub PAT：PR 雷达无法调用 GitHub API"
          }
          action={
            <Space>
              <Button size="small" onClick={() => void fetchTokenStatus()}>
                重新检测
              </Button>
              <Button size="small" type="primary" onClick={() => setTokenModalOpen(true)}>
                {tokenConfigured ? "更新 Token" : "填写 Token"}
              </Button>
            </Space>
          }
        />

        <Card title="监听任务">
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Button type="primary" onClick={openCreate}>
                新建监听
              </Button>
              <span style={{ color: "#666", fontSize: 13 }}>
                每条监听任务在库里<strong>最多只保留一条</strong>合并 PR；pulls 仍为 <code>
                  per_page=1
                </code>
                ；Bot backlog 每轮也<strong>最多处理一条</strong>。
                <strong>定时调度与「立即拉取」均异步入队</strong>，侧栏可轮询作业日志。
              </span>
            </Space>
          </div>
          <Table<PrRadarWatchTask>
            rowKey="id"
            loading={loadingTasks}
            columns={taskColumns}
            dataSource={tasks}
            pagination={{ pageSize: 8, showSizeChanger: true }}
          />
        </Card>

        <Card title="已入库合并 PR">
          <div style={{ marginBottom: 16 }} className="flex flex-wrap items-center gap-3">
            <span className="text-gray-600">按任务筛选</span>
            <Select
              allowClear
              placeholder="全部任务"
              style={{ minWidth: 280 }}
              options={taskOptions}
              value={filterTaskId}
              onChange={(v) => setFilterTaskId(v)}
            />
          </div>
          <Table<PrRadarMergedPr>
            rowKey="id"
            loading={loadingMerged}
            columns={mergedColumns}
            dataSource={merged}
            pagination={{ pageSize: 15, showSizeChanger: true }}
          />
        </Card>
      </Space>

      <Modal
        title={editing ? "编辑监听任务" : "新建监听任务"}
        open={modalOpen}
        width={920}
        styles={{ body: { maxHeight: "78vh", overflowY: "auto", paddingTop: 12 } }}
        onOk={() => void submitTask()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="仓库地址"
            name="repositoryUrl"
            rules={[{ required: true, message: "填写 GitHub HTTPS / SSH / owner/repo 形式" }]}
            extra='例如：https://github.com/facebook/react.git 或 "facebook/react"'
          >
            <Input placeholder="https://github.com/owner/repo" />
          </Form.Item>
          <Form.Item
            label="监听的分支（PR 的目标 base）"
            name="branch"
            rules={[{ required: true, message: "请输入分支名（如 main）" }]}
          >
            <Input placeholder="main" />
          </Form.Item>
          <Form.Item
            label="监听频率（分钟）"
            name="intervalMinutes"
            rules={[{ required: true, message: "请输入监听频率（分钟）" }]}
          >
            <InputNumber min={1} max={1440} className="w-full" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider titlePlacement="start">Bot 推送内容</Divider>
          <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12 }}>
            Bot 在 fork 上写入 canyon-bot 分支时，会先删除该分支下 <code>.github/workflows/</code> 目录中的
            全部条目，再写入<strong>固定路径 </strong>
            <code>{BOT_WORKFLOW_REPO_PATH}</code>，随后按下列「覆盖文件」逐项 PUT（有则覆盖，无则创建）。
          </Typography.Paragraph>

          <Form.Item
            label={
              <span className="flex flex-wrap items-center gap-1">
                <span>强制 CI 工作流（Monaco）</span>
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{BOT_WORKFLOW_REPO_PATH}</code>
              </span>
            }
            name="botWorkflowYaml"
            rules={[{ required: true, message: "必填：test.yaml 正文" }]}
          >
            <YamlEditorField />
          </Form.Item>

          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            以下为仓库根相对路径；禁止使用 <code>.github/workflows/</code> 下的路径。
          </Typography.Paragraph>

          <Form.List name="botOverlayFiles">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ path: "", content: "" })}>
                  添加覆盖文件
                </Button>
                {fields.map((field, idx) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`覆盖文件 #${idx + 1}`}
                    extra={
                      <Button type="link" danger size="small" onClick={() => remove(field.name)}>
                        移除
                      </Button>
                    }
                  >
                    <Form.Item label="相对路径" name={[field.name, "path"]}>
                      <Input placeholder="scripts/a.ts" />
                    </Form.Item>
                    <Form.Item label="正文（覆盖写入）" name={[field.name, "content"]}>
                      <TextBlobEditorField />
                    </Form.Item>
                  </Card>
                ))}
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title="保存 GitHub Token（写入 Infra 表 id=GITHUB_PRIVATE_TOKEN）"
        open={tokenModalOpen}
        onOk={() => void saveToken()}
        onCancel={() => setTokenModalOpen(false)}
        destroyOnHidden
      >
        <Form form={tokenForm} layout="vertical">
          <Form.Item
            label="Personal Access Token"
            name="token"
            rules={[{ required: true, message: "请输入 Token" }]}
          >
            <Input.Password placeholder="github_pat_..." autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={trackedJob ? `抓取异步作业 · ${trackedJob.status}` : "抓取异步作业"}
        open={pollDrawerOpen}
        onClose={() => {
          setPollDrawerOpen(false);
          setTrackedJobId(null);
        }}
        width={640}
        destroyOnHidden
      >
        {trackedJobId ? (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap align="center">
              <Tag>jobId</Tag>
              <code style={{ fontSize: 12 }}>{trackedJobId}</code>
              {trackedJob ? (
                <>
                  <Tag
                    color={
                      trackedJob.status === "SUCCEEDED"
                        ? "green"
                        : trackedJob.status === "FAILED"
                          ? "red"
                          : undefined
                    }
                  >
                    {trackedJob.status}
                  </Tag>
                  {trackedJob.newCount !== null && trackedJob.newCount !== undefined ? (
                    <Tag>入库 newCount={trackedJob.newCount}</Tag>
                  ) : null}
                </>
              ) : (
                <Tag color="processing">连接中…</Tag>
              )}
            </Space>
            {trackedJob?.error ? (
              <Alert type="error" message="作业失败" description={trackedJob.error} />
            ) : null}
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: "#f5f5f5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "70vh",
                overflow: "auto",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {trackedJob?.logText ?? "等待 worker 写入日志…"}
            </pre>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              约每 1.6 秒轮询接口 <code style={{ fontSize: 11 }}>GET /api/pr-radar/jobs/:id</code>
              读取 <code>logText</code>
              ；抓取与 Fork/Bot 在服务端 worker 中顺序执行。
            </Typography.Text>
          </Space>
        ) : (
          <div />
        )}
      </Drawer>
    </BasicLayout>
  );
};

export default PrRadarPage;
