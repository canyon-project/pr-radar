import { Layout, Menu, theme } from "antd";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const { Sider, Content } = Layout;

type BasicLayoutProps = {
  children: ReactNode;
};

const BasicLayout = ({ children }: BasicLayoutProps) => {
  const location = useLocation();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={220}>
        <div
          style={{
            padding: "16px 20px",
            color: "rgba(255,255,255,0.95)",
            fontWeight: 600,
          }}
        >
          工作台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={[
            { key: "/", label: <Link to="/">首页</Link> },
            {
              key: "/projects",
              label: <Link to="/projects">项目 · 笔记</Link>,
            },
          ]}
        />
      </Sider>
      <Layout
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Content
          style={{
            flex: 1,
            margin: 16,
            padding: 24,
            minHeight: 0,
            overflow: "auto",
            background: colorBgContainer,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default BasicLayout;
