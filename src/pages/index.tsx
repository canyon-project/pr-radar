import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigation = useNavigate();
  useEffect(() => {
    navigation("/projects");
  }, []);
  return <div></div>;
};

export default Index;
