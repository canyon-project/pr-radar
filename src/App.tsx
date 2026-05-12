import { useRoutes } from "react-router-dom";
import routes from "~react-pages";

const App = () => {
  return (
    <div>
      <div>{useRoutes(routes)}</div>
    </div>
  );
};

export default App;
