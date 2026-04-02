const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// react-native-quick-crypto shim
config.resolver.alias = {
  ...config.resolver.alias,
  crypto: 'react-native-quick-crypto',
};

module.exports = withNativeWind(config, { input: './global.css' });
