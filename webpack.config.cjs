const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './app.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'assets/app.[contenthash:8].js',
    clean: true,
    publicPath: './',
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      filename: 'index.html',
      inject: 'body',
      scriptLoading: 'defer',
      minify: false,
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'styles.css', to: 'styles.css' },
      ],
    }),
  ],
  optimization: {
    minimize: true,
  },
  devtool: 'source-map',
};
