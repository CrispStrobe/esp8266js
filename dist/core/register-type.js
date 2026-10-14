export var RegisterType;
(function (RegisterType) {
    RegisterType.PC = 0 << 24;
    RegisterType.AR = 1 << 24;
    RegisterType.Special = 2 << 24;
    RegisterType.User = 3 << 24;
    RegisterType.FP = 4 << 24;
    RegisterType.Mask = 0xff000000;
})(RegisterType || (RegisterType = {}));
//# sourceMappingURL=register-type.js.map