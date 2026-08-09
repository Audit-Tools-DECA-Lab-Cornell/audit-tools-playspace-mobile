export default {
    expo: {
        name: "COPA",
        slug: "audit-tools-playspace-mobile",
        version: "0.8.1",
        orientation: "portrait",
        scheme: "copa-mobile",
        icon: "./assets/icon.png",
        userInterfaceStyle: "automatic",
        assetBundlePatterns: ["**/*"],
        ios: {
            supportsTablet: true,
            icon: "./assets/ios-icons/AppIcon.icon",
            buildNumber: "1",
            bundleIdentifier: "com.pratyush.sudhakar.audit-tools-playspace-mobile",
            appleTeamId: "ZD947U862S",
            infoPlist: {
                ITSAppUsesNonExemptEncryption: false,
            },
        },
        android: {
            icon: "./assets/android-icons/favicon.png",
            softwareKeyboardLayoutMode: "pan",
            adaptiveIcon: {
                foregroundImage: "./assets/android-icons/adaptive-icon.png",
                backgroundColor: "#F7F1EB",
                monochromeImage: "./assets/android-icons/adaptive-monochrome.png",
            },
            package: "com.pratyush.sudhakar.audittoolsplayspacemobile",
        },
        plugins: [
            "./plugins/withCustomPodfilePatches",
            ["expo-navigation-bar", { hidden: true }],
            [
                "expo-splash-screen",
                {
                    backgroundColor: "#F7F1EB",
                    image: "./assets/splash-icon.png",
                    imageWidth: 200,
                    dark: {
                        backgroundColor: "#0E0E0E",
                        image: "./assets/splash-icon.png",
                    },
                },
            ],
            "expo-router",
            "expo-localization",
            "expo-font",
            [
                "react-native-maps",
                {
                    iosGoogleMapsApiKey: process.env.IOS_GOOGLE_MAPS_API_KEY,
                    androidGoogleMapsApiKey: process.env.ANDROID_GOOGLE_MAPS_API_KEY,
                },
            ],
            [
                "expo-build-properties",
                {
                    ios: {
                        newArchEnabled: false,
                        deploymentTarget: "15.1",
                    },
                    android: {
                        newArchEnabled: false,
                        compileSdkVersion: 36,
                        targetSdkVersion: 36,
                        buildToolsVersion: "36.0.0",
                    },
                },
            ],
            "expo-web-browser",
            "expo-secure-store",
            "expo-background-task",
            "expo-sharing",
        ],
        experiments: {
            typedRoutes: true,
        },
        jsEngine: "hermes",
        extra: {
            router: {},
            buildChannel: process.env.EXPO_PUBLIC_BUILD_CHANNEL ?? "development",
            testingMigration: {
                deprecatedInternalBuild: process.env.EXPO_PUBLIC_DEPRECATED_INTERNAL_BUILD ?? "false",
                remoteConfigUrl: process.env.EXPO_PUBLIC_TESTING_MIGRATION_CONFIG_URL ?? "",
                closedTestUrl: process.env.EXPO_PUBLIC_CLOSED_TEST_URL ?? "",
            },
            eas: {
                projectId: "2e559376-25f3-44e1-88bf-00eeaf9fb763",
            },
        },
        runtimeVersion: {
            policy: "fingerprint",
        },
        owner: "copa-decalab-cornell",
        githubUrl: "https://github.com/audit-tools-deca-lab-cornell/copa-mobile",
        updates: {
            url: "https://u.expo.dev/2e559376-25f3-44e1-88bf-00eeaf9fb763",
            enableTracking: true,
            enableBsdiffPatchSupport: true,
        },
    },
};
