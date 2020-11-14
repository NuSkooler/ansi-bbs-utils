const OutputSequenceCodes = {
    //  Cursor Next Line - CSI p1 E
    //  Move to beginning of line p1 lines down, default = 1
    cnl         : 'E',  //  Cursor Next Line
    nextLine    : 'E',  //  Alias

    //  Cursor Previous Line - CSI p1 F
    //  Move to beginning of line p1 lines up, default = 1
    cpl         : 'F',  //  Cursor Previous Line
    prevLine    : 'F',  //  Alias

    //  Cursor Horizontal Absolute - CSI p1 G
    //  Move cursor to column p1
    cha         : 'G',  //  Cursor Horizontal Absolute

    //  :TODO: hvp

}