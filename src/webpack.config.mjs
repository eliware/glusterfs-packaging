import MiniCssExtractPlugin from "mini-css-extract-plugin";
import CssMinimizerPlugin from "css-minimizer-webpack-plugin";
import path from "node:path";

const outputPath =
  process.env.WEB_ASSET_OUTPUT || path.resolve(process.cwd(), "artifacts/web");
const pretty = process.env.WEB_ASSET_VARIANT === "pretty";
const readable = pretty || process.env.WEB_ASSET_VARIANT === "readable";

export default {
  mode: readable ? "development" : "production",
  entry: "./fe/app.mjs",
  output: {
    filename: pretty ? "app.pretty.js" : "app.js",
    path: path.resolve(outputPath),
    clean: false,
    assetModuleFilename: "fonts/[name][ext][query]",
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { sourceMap: readable } },
        ],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: pretty ? "app.pretty.css" : "app.css",
    }),
  ],
  optimization: readable
    ? { minimize: false }
    : { minimizer: ["...", new CssMinimizerPlugin()] },
  devtool: "source-map",
};
