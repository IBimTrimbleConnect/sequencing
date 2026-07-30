import axios from "axios";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

function getLocalToken() {
  const token = localStorage.getItem("trimbleToken");
  console.log("token from local storage");
  return token;
}

const instance = axios.create({
  baseURL: localStorage.getItem("apiurl"),
  headers: {
    "Content-Type": "application/json",
  },
});

instance.setToken = (token) => {
  instance.defaults.headers["Authorization"] = "Bearer " + token;
  window.localStorage.setItem("trimbleToken", token);
};

instance.interceptors.request.use(
  (request) => {
    const token = getLocalToken();
    if (token) {
      request.headers["Authorization"] = "Bearer " + token;
      request.baseURL = localStorage.getItem("apiurl");
    }
    return request;
  },
  (error) => {
    return Promise.reject(error);
  }
);

instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    console.error("Request error", error);
    if (error.response && error.response.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        console.error("Error status", error.response.status);
        const tcapi = await WorkspaceAPI.connect(window.parent);
        const token = await tcapi.extension.requestPermission("accesstoken");
        if (token) {
          console.log("Get new token from server");
          console.log(token);
          window.localStorage.setItem("trimbleToken", token);
          const retryConfig = { ...error.config };
          retryConfig.headers["Authorization"] = "Bearer " + token;
          retryConfig.baseURL = localStorage.getItem("apiurl")

          return instance(retryConfig);
        }
      } catch (tokenError) {
        console.error("Failed to refresh token", tokenError);
        return Promise.reject(tokenError);
      }
    }

    return Promise.reject(error);
  }
);


export default instance;
